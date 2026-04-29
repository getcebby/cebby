#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-sys --no-config
/**
 * Cebby v1 -> v2 data migration.
 *
 * Reads from the OLD Supabase project (the v1.5 staging schema we've been
 * iterating on), transforms each row to the v2 shape, writes to the NEW
 * Supabase project, and re-hosts every cover photo to Cloudflare R2 along
 * the way.
 *
 * Idempotent — re-running upserts on natural keys, never duplicates.
 *
 * Usage:
 *   deno run --allow-net --allow-env --allow-read --allow-sys --no-config \
 *     services/core/scripts/migrate-v1-to-v2.ts
 *
 * Flags (set in .env.migration):
 *   DRY_RUN=1            — print the plan, write nothing
 *   SKIP_IMAGE_REHOST=1  — copy URLs verbatim, don't fetch+upload to R2
 *   IMAGE_CONCURRENCY=N  — parallelism for R2 uploads (default 4)
 *
 * After it completes, run the printed sequence-reset SQL in the v2 project's
 * SQL editor so future inserts pick up where the migrated ids left off.
 */

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { PutObjectCommand, S3Client } from 'npm:@aws-sdk/client-s3@3';
import { load } from 'jsr:@std/dotenv@0.225';

// =============================================================================
// 1. Env loading
// =============================================================================

const ENV_PATH = new URL('./.env.migration', import.meta.url).pathname;
// export: false so the file doesn't overwrite process env. Command-line vars
// (e.g. DRY_RUN=1 deno run ...) should always win over the .env file.
const env = await load({ envPath: ENV_PATH, export: false });

function need(key: string): string {
    const v = Deno.env.get(key) ?? env[key];
    if (!v) {
        console.error(`✗ Missing required env var: ${key}  (file: ${ENV_PATH})`);
        Deno.exit(1);
    }
    return v;
}
function opt(key: string, fallback = ''): string {
    return Deno.env.get(key) ?? env[key] ?? fallback;
}

const DRY_RUN = opt('DRY_RUN') === '1';
const SKIP_IMAGE_REHOST = opt('SKIP_IMAGE_REHOST') === '1';
const IMAGE_CONCURRENCY = parseInt(opt('IMAGE_CONCURRENCY', '4'), 10);

const OLD_URL  = need('OLD_SUPABASE_URL');
const OLD_KEY  = need('OLD_SUPABASE_SERVICE_ROLE_KEY');
const NEW_URL  = need('NEW_SUPABASE_URL');
const NEW_KEY  = need('NEW_SUPABASE_SERVICE_ROLE_KEY');

const R2_ACCOUNT_ID         = need('R2_ACCOUNT_ID');
const R2_ACCESS_KEY_ID      = need('R2_ACCESS_KEY_ID');
const R2_SECRET_ACCESS_KEY  = need('R2_SECRET_ACCESS_KEY');
const R2_BUCKET             = need('R2_BUCKET');
const R2_PUBLIC_URL         = need('R2_PUBLIC_URL').replace(/\/+$/, '');


// =============================================================================
// 2. Clients
// =============================================================================

const oldDb: SupabaseClient = createClient(OLD_URL, OLD_KEY, { auth: { persistSession: false } });
const newDb: SupabaseClient = createClient(NEW_URL, NEW_KEY, { auth: { persistSession: false } });

// R2 is S3-compatible. The endpoint is account-scoped; bucket is in the path.
const r2 = new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
});


// =============================================================================
// 3. Logging
// =============================================================================

const startedAt = Date.now();
function ts(): string {
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    return `+${elapsed}s`;
}
function log(...args: unknown[])  { console.log(`[${ts()}]`, ...args); }
function warn(...args: unknown[]) { console.warn(`[${ts()}] ⚠`, ...args); }
function step(name: string)        { console.log(`\n[${ts()}] ━━━ ${name}\n`); }


// =============================================================================
// 4. Image re-host (cover photos -> R2)
// =============================================================================

const imageCache = new Map<string, string>(); // sourceUrl -> r2Url (for dedup across same-photo events)

// Browser-ish UA — some CDNs (notably FB) reject default fetch UAs even for
// public images. Doesn't fix expired-token URLs (those are permanently 403),
// but recovers the marginal cases that fail purely on UA filtering.
const FETCH_HEADERS = {
    'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Accept': 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8,*/*;q=0.5',
};

async function fetchBytes(url: string): Promise<{ bytes: Uint8Array; contentType: string } | null> {
    try {
        const res = await fetch(url, { redirect: 'follow', headers: FETCH_HEADERS });
        if (!res.ok) {
            warn(`fetch ${url} -> HTTP ${res.status}`);
            return null;
        }
        const contentType = res.headers.get('content-type') ?? '';
        // Reject non-image responses. FB / lumacdn sometimes return 200 with
        // an HTML error/login page for restricted events; without this check
        // we'd upload HTML bytes as a .jpg → broken image in the browser.
        if (!contentType.toLowerCase().startsWith('image/')) {
            warn(`non-image content-type "${contentType}" from ${url} — skipping`);
            return null;
        }
        const bytes = new Uint8Array(await res.arrayBuffer());
        return { bytes, contentType };
    } catch (err) {
        warn(`fetch error for ${url}:`, err instanceof Error ? err.message : err);
        return null;
    }
}

function extFromContentType(ct: string): string {
    const m = ct.match(/image\/([a-z0-9]+)/i);
    if (!m) return 'jpg';
    const e = m[1].toLowerCase();
    if (e === 'jpeg') return 'jpg';
    return e;
}

/**
 * Fetch an image from `sourceUrl` and upload it to R2. Returns the public R2
 * URL. Caches by source URL so events sharing a cover photo only hit R2 once.
 */
async function rehostImage(sourceUrl: string, key: string): Promise<string | null> {
    if (imageCache.has(sourceUrl)) return imageCache.get(sourceUrl)!;

    const fetched = await fetchBytes(sourceUrl);
    if (!fetched) return null;

    const ext = extFromContentType(fetched.contentType);
    const objectKey = `${key}.${ext}`;

    if (DRY_RUN) {
        const publicUrl = `${R2_PUBLIC_URL}/${objectKey}`;
        imageCache.set(sourceUrl, publicUrl);
        return publicUrl;
    }

    try {
        await r2.send(new PutObjectCommand({
            Bucket: R2_BUCKET,
            Key: objectKey,
            Body: fetched.bytes,
            ContentType: fetched.contentType,
            CacheControl: 'public, max-age=31536000, immutable',
        }));
    } catch (err) {
        warn(`R2 upload failed for ${objectKey}:`, err instanceof Error ? err.message : err);
        return null;
    }

    const publicUrl = `${R2_PUBLIC_URL}/${objectKey}`;
    imageCache.set(sourceUrl, publicUrl);
    return publicUrl;
}

// Bounded-concurrency runner so we don't open hundreds of fetches at once.
async function mapWithConcurrency<T, U>(
    items: T[],
    fn: (t: T, i: number) => Promise<U>,
    concurrency: number,
): Promise<U[]> {
    const out: U[] = new Array(items.length);
    let cursor = 0;
    async function worker() {
        while (true) {
            const i = cursor++;
            if (i >= items.length) return;
            out[i] = await fn(items[i], i);
        }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
    return out;
}


// =============================================================================
// 5. Helpers
// =============================================================================

/** Read every row from a v1 table, paginated. supabase-js caps at 1000 per page. */
async function readAll<T>(client: SupabaseClient, table: string, select = '*'): Promise<T[]> {
    const PAGE = 1000;
    const out: T[] = [];
    let from = 0;
    while (true) {
        const { data, error } = await client
            .from(table)
            .select(select)
            .range(from, from + PAGE - 1);
        if (error) throw new Error(`read ${table}: ${error.message}`);
        if (!data || data.length === 0) break;
        out.push(...(data as T[]));
        if (data.length < PAGE) break;
        from += PAGE;
    }
    return out;
}

/** Upsert a batch with a chunk size that respects the 1000-row PostgREST cap. */
async function upsertBatch(
    table: string,
    rows: Record<string, unknown>[],
    onConflict: string,
): Promise<void> {
    if (rows.length === 0) return;
    if (DRY_RUN) {
        log(`  [DRY] would upsert ${rows.length} into ${table}`);
        return;
    }
    const CHUNK = 500;
    for (let i = 0; i < rows.length; i += CHUNK) {
        const chunk = rows.slice(i, i + CHUNK);
        const { error } = await newDb.from(table).upsert(chunk, { onConflict });
        if (error) throw new Error(`upsert ${table}[${i}..${i + chunk.length}]: ${error.message}`);
    }
}


// =============================================================================
// 6. v1 row shapes (loose typing — only what we read)
// =============================================================================

interface V1Organization {
    id: number;
    name: string;
    slug: string | null;
    source_priority: string[] | null;
    primary_photo: string | null;
    website: string | null;
    is_individual: boolean;
    is_active: boolean;
    created_at: string;
    updated_at: string;
}

interface V1Account {
    id: number;
    account_id: string;
    name: string | null;
    type: string | null;
    kind: string | null;
    primary_photo: string | null;
    account_details: Record<string, unknown> | null;
    organization_id: number | null;
    is_active: boolean;
    access_token: string | null;
    page_access_token: string | null;
    created_at: string;
}

interface V1Event {
    id: number;
    name: string | null;
    description: string | null;
    start_time: string | null;
    end_time: string | null;
    created_at: string;
    location: string | null;
    location_details: { latitude: number; longitude: number } | null;
    source_id: string | null;
    source: string | null;
    account_id: string | null;
    cover_photo: string | null;
    is_featured: boolean;
    is_facebook_pages: boolean | null;
    ticket_url: string | null;
    slug: string | null;
    is_hidden: boolean | null;
    primary_source_link_id: number | null;
}

interface V1EventSourceLink {
    id: number;
    event_id: number;
    source: string;
    source_id: string;
    url: string | null;
    scraped_at: string;
    raw: unknown;
    created_at: string;
}

interface V1EventOrganizer {
    event_id: number;
    account_id: string;
    role: string;
    position: number;
    created_at: string;
}

interface V1EventSlug {
    slug: string;
    event_id: number;
}


// =============================================================================
// 7. Migration steps
// =============================================================================

async function migrateOrganizations() {
    step('organizations');
    const rows = await readAll<V1Organization>(oldDb, 'organizations');
    log(`read ${rows.length} organizations from v1`);

    // Slug fallback: v1 allowed null slugs; v2 doesn't. Synthesize from id.
    const out = rows.map((r) => ({
        id: r.id,
        slug: r.slug ?? `org-${r.id}`,
        name: r.name,
        primary_photo: r.primary_photo,
        source_priority: r.source_priority,
        is_individual: r.is_individual,
        is_active: r.is_active,
        // v2-new fields default to NULL — to be filled by admin later.
        // tagline, description, cover_photo, city, region, country (default 'PH'),
        // lead_contact_*, social_links, founded_year, verified_at
        country: 'PH',
        created_at: r.created_at,
        updated_at: r.updated_at,
    }));

    await upsertBatch('organizations', out, 'id');
    log(`  upserted ${out.length} organizations`);
}

async function migrateAccounts() {
    step('accounts (+ account_secrets split)');
    const rows = await readAll<V1Account>(oldDb, 'accounts');
    log(`read ${rows.length} accounts from v1`);

    const accountRows: Record<string, unknown>[] = [];
    const secretRows: Record<string, unknown>[]  = [];

    for (const r of rows) {
        // discovery_path: promoted from account_details.path (Luma convention)
        // or fallback to account_id-shaped username for FB pages.
        const path = (r.account_details as { path?: string } | null)?.path ?? null;

        // ingest_kind: 'partnership' if we have a working FB page token,
        // otherwise 'public_scrape'. Manual edits set this themselves later.
        const hasToken = !!(r.access_token || r.page_access_token);
        const ingest_kind = hasToken && r.type === 'facebook' ? 'partnership' : 'public_scrape';

        accountRows.push({
            account_id: r.account_id,
            name: r.name ?? '(unnamed)',
            type: r.type ?? 'unknown',
            kind: r.kind ?? 'unknown',
            primary_photo: r.primary_photo,
            discovery_path: path,
            account_details: r.account_details,
            ingest_kind,
            organization_id: r.organization_id,
            is_active: r.is_active,
            created_at: r.created_at,
        });

        if (hasToken) {
            secretRows.push({
                account_id: r.account_id,
                access_token: r.access_token,
                page_access_token: r.page_access_token,
            });
        }
    }

    await upsertBatch('accounts', accountRows, 'account_id');
    log(`  upserted ${accountRows.length} accounts`);

    if (secretRows.length > 0) {
        await upsertBatch('account_secrets', secretRows, 'account_id');
        log(`  upserted ${secretRows.length} account_secrets`);
    } else {
        log(`  no account_secrets to migrate`);
    }
}

async function migrateEvents() {
    step('events (+ R2 image re-host)');
    const rows = await readAll<V1Event>(oldDb, 'events');
    log(`read ${rows.length} events from v1`);

    // First pass: re-host cover photos to R2 (parallel, bounded).
    const eventsWithPhotos = rows.filter((r) => !!r.cover_photo);
    log(`  ${eventsWithPhotos.length} events have a cover photo to re-host`);

    let progress = 0;
    const rehosted = new Map<number, string | null>();
    if (!SKIP_IMAGE_REHOST) {
        await mapWithConcurrency(
            eventsWithPhotos,
            async (e) => {
                const key = `events/${e.slug ?? `event-${e.id}`}`;
                const newUrl = await rehostImage(e.cover_photo!, key);
                rehosted.set(e.id, newUrl);
                progress++;
                if (progress % 25 === 0 || progress === eventsWithPhotos.length) {
                    log(`  re-hosted ${progress}/${eventsWithPhotos.length} cover photos`);
                }
                return newUrl;
            },
            IMAGE_CONCURRENCY,
        );
    } else {
        log('  SKIP_IMAGE_REHOST=1 — keeping original cover_photo URLs');
    }

    // Second pass: build v2 event rows.
    let coverFailures = 0;
    const out = rows.map((r) => {
        const status = r.is_hidden ? 'hidden' : 'published';
        const format = r.location && /^online\b/i.test(r.location) ? 'online' : 'in_person';

        // If image re-host failed (FB CDN URLs with expired auth, dead links,
        // etc.), write NULL instead of the broken URL. The PWA shows a
        // placeholder gracefully; a stored-but-broken URL gives users the
        // broken-image icon. Future re-scrapes can fill in fresh URLs.
        let newCover: string | null;
        if (SKIP_IMAGE_REHOST) {
            newCover = r.cover_photo;
        } else if (!r.cover_photo) {
            newCover = null;
        } else {
            const rehostedUrl = rehosted.get(r.id);
            if (rehostedUrl == null) {
                coverFailures++;
                newCover = null;
            } else {
                newCover = rehostedUrl;
            }
        }

        return {
            id: r.id,
            name: r.name ?? '(untitled event)',
            description: r.description,
            start_time: r.start_time,
            end_time: r.end_time,
            // timezone left NULL for legacy events; new ingest will populate it.
            location: r.location,
            location_details: r.location_details,
            cover_photo: newCover,
            // cover_blurhash left NULL — computed by future ingest pipeline.
            status,
            format,
            // is_free / price_* left NULL (unknown for legacy data).
            currency: 'PHP',
            is_featured: r.is_featured,
            slug: r.slug,
            // primary_source_link_id deferred — set by linkPrimarySourceLinks
            // after event_source_links are populated. Inserting it here would
            // violate the FK constraint since the target rows don't exist yet.
            primary_source_link_id: null,
            country: 'PH',
            created_at: r.created_at,
        };
    });

    await upsertBatch('events', out, 'id');
    log(`  upserted ${out.length} events`);
    if (coverFailures > 0) {
        log(`  ${coverFailures} cover photos could not be re-hosted → cover_photo set to NULL`);
    }
}

async function migrateSourceLinks() {
    step('event_source_links');
    const rows = await readAll<V1EventSourceLink>(oldDb, 'event_source_links');
    log(`read ${rows.length} event_source_links from v1`);

    // Pull account ingest_kind so we can stamp it on the link's ingest_kind.
    // Most v1 source-links were created before the ingest_kind concept existed,
    // so we infer: any FB link whose account has a partnership token =
    // 'partnership'; everything else = 'public_scrape'.
    const { data: accounts } = await newDb
        .from('accounts')
        .select('account_id, ingest_kind, type');
    const accountIngestByAccountId = new Map<string, string>();
    for (const a of (accounts ?? []) as { account_id: string; ingest_kind: string; type: string }[]) {
        accountIngestByAccountId.set(a.account_id, a.ingest_kind);
    }

    // We need to find the account_id for each link via event_organizers (the
    // primary host's account). Simpler: just default to public_scrape for all
    // existing links — we can't reconstruct historical reliability tier.
    const out = rows.map((r) => ({
        id: r.id,
        event_id: r.event_id,
        source: r.source,
        source_id: r.source_id,
        url: r.url,
        ingest_kind: 'public_scrape',
        scraped_at: r.scraped_at,
        raw: r.raw,
        created_at: r.created_at,
    }));

    await upsertBatch('event_source_links', out, 'id');
    log(`  upserted ${out.length} event_source_links`);
}

async function linkPrimarySourceLinks() {
    step('events.primary_source_link_id (deferred FK)');

    // Re-read from v1 since migrateEvents discarded primary_source_link_id.
    // Both events and event_source_links preserve numeric ids, so v1's value
    // is valid in v2 as long as the source_links row was written above.
    const { data: v1pairs, error } = await oldDb
        .from('events')
        .select('id, primary_source_link_id')
        .not('primary_source_link_id', 'is', null);
    if (error) throw new Error(`read v1 primary links: ${error.message}`);

    const pairs = (v1pairs ?? []) as { id: number; primary_source_link_id: number }[];
    log(`${pairs.length} events have a primary_source_link_id to set`);

    if (DRY_RUN) {
        log(`  [DRY] would update ${pairs.length} events`);
        return;
    }

    // No bulk update API in supabase-js; do it in chunks of parallel updates.
    const CHUNK = 50;
    for (let i = 0; i < pairs.length; i += CHUNK) {
        const slice = pairs.slice(i, i + CHUNK);
        const results = await Promise.all(
            slice.map((p) =>
                newDb
                    .from('events')
                    .update({ primary_source_link_id: p.primary_source_link_id })
                    .eq('id', p.id),
            ),
        );
        const errs = results.filter((r) => r.error).map((r) => r.error!.message);
        if (errs.length > 0) {
            warn(`  ${errs.length} update errors in chunk; first: ${errs[0]}`);
        }
    }
    log(`  updated ${pairs.length} events`);
}

async function migrateOrganizers() {
    step('event_organizers');
    const rows = await readAll<V1EventOrganizer>(oldDb, 'event_organizers');
    log(`read ${rows.length} event_organizers from v1`);

    const out = rows.map((r) => ({
        event_id: r.event_id,
        account_id: r.account_id,
        role: r.role,
        position: r.position,
        created_at: r.created_at,
    }));

    await upsertBatch('event_organizers', out, 'event_id,account_id');
    log(`  upserted ${out.length} event_organizers`);
}

async function migrateSlugs() {
    step('event_slugs');
    const rows = await readAll<V1EventSlug>(oldDb, 'event_slugs');
    log(`read ${rows.length} event_slugs from v1`);

    // v2's event_slugs has is_current; mark the slug matching events.slug as
    // current. Pull current slugs from the freshly-migrated v2 events table.
    const { data: events } = await newDb.from('events').select('id, slug');
    const currentByEvent = new Map<number, string>();
    for (const e of (events ?? []) as { id: number; slug: string | null }[]) {
        if (e.slug) currentByEvent.set(e.id, e.slug);
    }

    const out = rows.map((r) => ({
        slug: r.slug,
        event_id: r.event_id,
        is_current: currentByEvent.get(r.event_id) === r.slug,
    }));

    await upsertBatch('event_slugs', out, 'slug');
    log(`  upserted ${out.length} event_slugs`);
}

async function migrateDormant() {
    step('dormant: profiles + event_registrations');

    // profiles
    try {
        const profiles = await readAll<Record<string, unknown>>(oldDb, 'profiles');
        if (profiles.length > 0) {
            await upsertBatch('profiles', profiles, 'id');
            log(`  upserted ${profiles.length} profiles`);
        } else {
            log('  no profiles to migrate');
        }
    } catch (err) {
        warn('profiles migration failed (table might not exist in old project):', err);
    }

    // event_registrations
    try {
        const regs = await readAll<Record<string, unknown>>(oldDb, 'event_registrations');
        if (regs.length > 0) {
            await upsertBatch('event_registrations', regs, 'id');
            log(`  upserted ${regs.length} event_registrations`);
        } else {
            log('  no event_registrations to migrate');
        }
    } catch (err) {
        warn('event_registrations migration failed (table might not exist):', err);
    }
}


// =============================================================================
// 8. Sequence reset SQL (printed for the user to run in v2 SQL editor)
// =============================================================================

function printSequenceResets() {
    step('NEXT STEP — run this in the v2 project SQL editor');
    console.log(`
-- Reset IDENTITY sequences so future inserts pick up where the migrated ids
-- left off. Without this, INSERT INTO events (...) DEFAULT VALUES collides
-- with existing rows.

SELECT setval(
    pg_get_serial_sequence('public.organizations', 'id'),
    GREATEST((SELECT COALESCE(MAX(id), 0) FROM public.organizations), 1)
);
SELECT setval(
    pg_get_serial_sequence('public.events', 'id'),
    GREATEST((SELECT COALESCE(MAX(id), 0) FROM public.events), 1)
);
SELECT setval(
    pg_get_serial_sequence('public.event_source_links', 'id'),
    GREATEST((SELECT COALESCE(MAX(id), 0) FROM public.event_source_links), 1)
);
SELECT setval(
    pg_get_serial_sequence('public.tags', 'id'),
    GREATEST((SELECT COALESCE(MAX(id), 0) FROM public.tags), 1)
);
SELECT setval(
    pg_get_serial_sequence('public.venues', 'id'),
    GREATEST((SELECT COALESCE(MAX(id), 0) FROM public.venues), 1)
);
`);
}


// =============================================================================
// 9. Main
// =============================================================================

async function preflight() {
    step('preflight');
    log(`OLD: ${OLD_URL}`);
    log(`NEW: ${NEW_URL}`);
    log(`R2:  ${R2_PUBLIC_URL}  (bucket: ${R2_BUCKET})`);
    log(`Mode: ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE WRITES'}`);
    log(`Image rehost: ${SKIP_IMAGE_REHOST ? 'SKIPPED' : `concurrency=${IMAGE_CONCURRENCY}`}`);

    // Verify v2 schema is present by checking for one v2-only table.
    const { error } = await newDb.from('organizations').select('id').limit(1);
    if (error) {
        console.error('\n✗ v2 schema check failed — has the migration SQL been applied?');
        console.error(`  ${error.message}`);
        Deno.exit(1);
    }
    log('v2 schema looks present (organizations table responds)');
}

async function main() {
    console.log('\n=== Cebby v1 → v2 data migration ===\n');
    await preflight();

    await migrateOrganizations();
    await migrateAccounts();
    await migrateEvents();
    await migrateSourceLinks();
    await linkPrimarySourceLinks();
    await migrateOrganizers();
    await migrateSlugs();
    await migrateDormant();

    printSequenceResets();

    log(`\n✓ Done in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
    if (DRY_RUN) {
        log('  (this was a DRY RUN — set DRY_RUN=0 in .env.migration to write)');
    }
}

main().catch((err) => {
    console.error('\n✗ migration failed:', err instanceof Error ? err.stack ?? err.message : err);
    Deno.exit(1);
});
