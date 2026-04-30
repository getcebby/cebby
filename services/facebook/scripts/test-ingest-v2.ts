#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-sys --no-config
/**
 * Local end-to-end test for Facebook (Graph API / partnership) ingest against
 * v2. Mirrors services/luma/scripts/test-ingest-v2.ts.
 *
 * Default account: JavaScript Cebu (593043454462797). Override with
 * --account=<name>  (ilike on accounts.name)
 * --account-id=<fb-page-id>
 *
 * Reads tokens from v2's account_secrets table — the same path the deployed
 * Edge Function will use. If the account has no tokens, it warns and exits
 * (those pages route via the no-token fb-scraper, not this path).
 */

import { load } from 'jsr:@std/dotenv@0.225';

// =============================================================================
// 1. Env + point shared client at v2 BEFORE imports that read env
// =============================================================================

const ENV_PATH = new URL('../../core/scripts/.env.migration', import.meta.url).pathname;
const env = await load({ envPath: ENV_PATH, export: false });

const NEW_URL = env.NEW_SUPABASE_URL ?? Deno.env.get('NEW_SUPABASE_URL');
const NEW_KEY = env.NEW_SUPABASE_SERVICE_ROLE_KEY ?? Deno.env.get('NEW_SUPABASE_SERVICE_ROLE_KEY');
if (!NEW_URL || !NEW_KEY) {
    console.error(`✗ Missing NEW_SUPABASE_URL / NEW_SUPABASE_SERVICE_ROLE_KEY (env: ${ENV_PATH})`);
    Deno.exit(1);
}
Deno.env.set('SUPABASE_URL', NEW_URL);
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', NEW_KEY);

for (const k of ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'R2_PUBLIC_URL']) {
    const v = env[k] ?? Deno.env.get(k);
    if (v) Deno.env.set(k, v);
}
const gmaps = env.GOOGLE_MAPS_KEY ?? Deno.env.get('GOOGLE_MAPS_KEY');
if (gmaps) Deno.env.set('GOOGLE_MAPS_KEY', gmaps);


// =============================================================================
// 2. Imports
// =============================================================================

const { createClient } = await import('npm:@supabase/supabase-js@2');
const ingestModule = await import('../../core/supabase/features/events/index.ts');
const { findOrCreateAccount, ingestEvents, getEventsByIds, storeCoverImages, geocodeEventLocations } = ingestModule;
const organizerModule = await import('../supabase/functions/_shared/organizers.ts');
const { resolveFacebookOrganizerHosts } = organizerModule;

// FacebookEvent shape — mirrors services/facebook/supabase/functions/_shared/types.ts.
interface FBLocation {
    name?: string;
    city?: string;
    region?: string;
    country?: string;
    country_code?: string;
    latitude?: number;
    longitude?: number;
}
interface FBPlace {
    id?: number;
    name?: string;
    location?: FBLocation;
}
interface FBCohost {
    id: string | number;
    name: string;
    category?: string;
}
interface FBEvent {
    id: number | string;
    name: string;
    description?: string;
    cover?: { source?: string };
    created_time?: string;
    start_time: string;
    end_time?: string;
    timezone?: string;
    is_online?: boolean;
    place?: FBPlace;
    cohosts?: { data: FBCohost[] } | FBCohost[];
}

const v2 = createClient(NEW_URL, NEW_KEY, { auth: { persistSession: false } });


// =============================================================================
// 3. Args
// =============================================================================

interface Args {
    accountName?: string;
    accountId?: string;
    limit: number;
}
function parseArgs(argv: string[]): Args {
    const out: Args = { limit: 5 };
    for (const a of argv) {
        if (a.startsWith('--account=')) out.accountName = a.slice('--account='.length);
        else if (a.startsWith('--account-id=')) out.accountId = a.slice('--account-id='.length);
        else if (a.startsWith('--limit=')) out.limit = parseInt(a.slice('--limit='.length), 10);
    }
    return out;
}
const args = parseArgs(Deno.args);


// =============================================================================
// 4. Pick the account + tokens
// =============================================================================

interface AccountRow {
    account_id: string;
    name: string;
    type: string;
    kind: string;
    ingest_kind: string;
    organization_id: number | null;
}

async function pickAccount(): Promise<AccountRow | null> {
    let q = v2.from('accounts')
        .select('account_id, name, type, kind, ingest_kind, organization_id')
        .eq('type', 'facebook')
        .eq('is_active', true);
    if (args.accountId) q = q.eq('account_id', args.accountId);
    else if (args.accountName) q = q.ilike('name', `%${args.accountName}%`);
    else q = q.ilike('name', '%javascript cebu%');
    const { data, error } = await q.limit(1).maybeSingle();
    if (error) {
        console.error(`✗ accounts read error: ${error.message}`);
        return null;
    }
    return data as AccountRow | null;
}

async function fetchTokens(accountId: string): Promise<{ access: string | null; page: string | null } | null> {
    const { data, error } = await v2.from('account_secrets')
        .select('access_token, page_access_token')
        .eq('account_id', accountId)
        .maybeSingle();
    if (error) {
        console.error(`✗ account_secrets read error: ${error.message}`);
        return null;
    }
    if (!data) return { access: null, page: null };
    return { access: data.access_token, page: data.page_access_token };
}


// =============================================================================
// 5. FB Graph fetch + buildIngest  (mirror of the Edge Function)
// =============================================================================

const GRAPH_FIELDS = [
    'id', 'name', 'cover', 'description', 'created_time',
    'timezone', 'start_time', 'end_time',
    'place{name,location{city,region,country,country_code,latitude,longitude}}',
    'cohosts',
].join(',');

async function fetchEventsFromFB(pageId: string, token: string): Promise<FBEvent[]> {
    const url = `https://graph.facebook.com/v21.0/${pageId}/events?fields=${GRAPH_FIELDS}&access_token=${token}&format=json&method=get`;
    const res = await fetch(url);
    if (!res.ok) {
        const body = await res.text();
        console.error(`✗ FB Graph error ${res.status}: ${body.slice(0, 500)}`);
        return [];
    }
    const json = (await res.json()) as { data?: FBEvent[] };
    return json.data ?? [];
}

async function buildIngest(event: FBEvent, owner: { account_id: string; name: string }) {
    const ownerId = owner.account_id;
    const organizerResolution = await resolveFacebookOrganizerHosts(event, owner);
    const organizers: Array<{ account_id: string; role?: string }> = [];

    for (const host of organizerResolution.hosts) {
        if (host.source === 'graph_owner') {
            organizers.push({ account_id: host.id, role: 'presenter' });
            continue;
        }

        const acc = await findOrCreateAccount({
            account_id: host.id,
            name: host.name,
            type: 'facebook',
            kind: 'fb_page',
            primary_photo: host.photoUrl ?? null,
        });
        if (acc) organizers.push({ account_id: String(acc.account_id), role: 'presenter' });
    }

    const loc = event.place?.location;
    const hasCoords = loc?.latitude != null && loc?.longitude != null;
    const format: 'in_person' | 'online' = event.is_online === true
        ? 'online'
        : hasCoords ? 'in_person' : 'online';

    return {
        name: event.name ?? '(unnamed)',
        description: event.description ?? null,
        start_time: event.start_time,
        end_time: event.end_time ?? null,
        timezone: event.timezone ?? null,
        format,
        location: event.place?.name ?? null,
        location_details: hasCoords ? { latitude: loc!.latitude!, longitude: loc!.longitude! } : null,
        city: loc?.city ?? null,
        region: loc?.region ?? null,
        country: loc?.country ?? null,
        cover_photo: event.cover?.source ?? null,
        source: 'facebook',
        source_id: String(event.id),
        source_url: `https://www.facebook.com/events/${event.id}`,
        ingest_kind: 'partnership' as const,
        raw: event as unknown,
        organizers,
        organizer_write_mode: organizerResolution.source === 'public_hosts' ? 'replace' as const : 'merge' as const,
    };
}


// =============================================================================
// 6. Main
// =============================================================================

async function main() {
    console.log(`\n=== FB Graph (partnership) → v2 ingest test ===`);
    console.log(`v2: ${NEW_URL}\n`);

    const account = await pickAccount();
    if (!account) {
        console.error(`✗ No matching active Facebook account found in v2`);
        Deno.exit(1);
    }
    console.log(`account: ${account.name} (${account.account_id})`);
    console.log(`  kind=${account.kind}  ingest_kind=${account.ingest_kind}  org=${account.organization_id ?? '(unlinked)'}`);

    const tokens = await fetchTokens(account.account_id);
    if (!tokens || (!tokens.access && !tokens.page)) {
        console.error(`✗ no tokens in account_secrets for this account — use fb-scraper (no-token strategy) instead`);
        Deno.exit(1);
    }
    const token = tokens.page ?? tokens.access!;
    console.log(`  using ${tokens.page ? 'page_access_token' : 'access_token'} (length=${token.length})`);

    console.log(`\n[1/5] fetching from FB Graph API...`);
    const allEvents = await fetchEventsFromFB(account.account_id, token);
    const events = allEvents.slice(0, args.limit);
    console.log(`  → ${allEvents.length} events available, processing first ${events.length}`);
    for (const e of events) {
        const loc = e.place?.location;
        console.log(`    • ${e.id} "${e.name}" — ${e.start_time}  place=${e.place?.name ?? 'none'}  coords=${loc?.latitude ?? '-'},${loc?.longitude ?? '-'}`);
    }

    if (events.length === 0) {
        console.log(`\n(no events to ingest)`);
        return;
    }

    console.log(`\n[2/5] building ingest payloads...`);
    const ingests = [];
    for (const e of events) {
        const ig = await buildIngest(e, account);
        ingests.push(ig);
        console.log(`     ${ig.source_id}: timezone=${ig.timezone ?? '-'}  format=${ig.format}  city=${ig.city ?? '-'}  organizers=${ig.organizers.length}`);
    }

    console.log(`\n[3/5] running ingestEvents...`);
    const results = await ingestEvents(ingests);
    for (const r of results) {
        console.log(
            `  → event_id=${r.event_id} new=${r.is_new_event} canonical=${r.became_canonical} match_score=${r.match_score?.toFixed(3) ?? 'n/a'}`,
        );
    }

    console.log(`\n[4/5] running enrichment (storeCoverImages + geocode)...`);
    const eventIds = results.map((r) => r.event_id);
    const eventRows = await getEventsByIds(eventIds);
    const coverResult = await storeCoverImages(eventRows);
    console.log(`  cover: processed ${coverResult.processedImages}/${coverResult.totalImages} (errors: ${coverResult.error ? 'yes' : 'none'})`);
    await geocodeEventLocations(eventRows);

    console.log(`\n[5/5] verifying final v2 state...`);
    for (const eventId of eventIds) {
        const [evRes, linksRes, orgRes] = await Promise.all([
            v2.from('events')
                .select('id, name, status, format, timezone, city, region, country, start_time, end_time, location, location_details, cover_photo, primary_source_link_id, slug')
                .eq('id', eventId)
                .maybeSingle(),
            v2.from('event_source_links')
                .select('id, source, source_id, url, ingest_kind, scraped_at')
                .eq('event_id', eventId)
                .order('scraped_at', { ascending: false }),
            v2.from('event_organizers')
                .select('role, position, account_id, accounts(account_id, name, kind, organization_id)')
                .eq('event_id', eventId)
                .order('position', { ascending: true }),
        ]);

        if (evRes.error)    console.error(`  events query error: ${evRes.error.message}`);
        if (linksRes.error) console.error(`  event_source_links query error: ${linksRes.error.message}`);
        if (orgRes.error)   console.error(`  event_organizers query error: ${orgRes.error.message}`);

        const ev = evRes.data as {
            id: number; name: string; status: string; format: string;
            timezone: string | null; city: string | null; region: string | null; country: string | null;
            start_time: string; end_time: string | null; location: string | null;
            location_details: { latitude: number; longitude: number } | null;
            cover_photo: string | null; primary_source_link_id: number | null; slug: string | null;
        } | null;
        if (!ev) { console.log(`  event #${eventId}: (✗ not found)`); continue; }

        const links = (linksRes.data ?? []) as Array<{ id: number; source: string; source_id: string; url: string | null; ingest_kind: string }>;
        const orgs = (orgRes.data ?? []) as Array<{ role: string; position: number; account_id: string; accounts: { account_id: string; name: string; kind: string; organization_id: number | null } | null }>;

        console.log(`\n  event #${eventId}:`);
        console.log(`    name=${ev.name}`);
        console.log(`    slug=${ev.slug ?? '(none)'}`);
        console.log(`    status=${ev.status}  format=${ev.format}  timezone=${ev.timezone ?? '(null)'}`);
        console.log(`    geo: city=${ev.city ?? '-'}  region=${ev.region ?? '-'}  country=${ev.country ?? '-'}`);
        console.log(`    start=${ev.start_time}  end=${ev.end_time ?? '(none)'}`);
        console.log(`    location=${ev.location ?? '(none)'}`);
        console.log(`    coords=${ev.location_details ? `${ev.location_details.latitude}, ${ev.location_details.longitude}` : '(none)'}`);
        console.log(`    cover=${ev.cover_photo ?? '(none)'}`);
        console.log(`    primary_source_link_id=${ev.primary_source_link_id ?? '(null)'}`);

        console.log(`    source_links (${links.length}):`);
        for (const l of links) {
            const star = l.id === ev.primary_source_link_id ? '★ ' : '  ';
            console.log(`      ${star}#${l.id} ${l.source}:${l.source_id}  ingest=${l.ingest_kind}`);
        }
        console.log(`    organizers (${orgs.length}):`);
        for (const o of orgs) {
            const a = o.accounts;
            console.log(`      pos=${o.position} role=${o.role} → ${a?.name ?? '(missing)'} (${o.account_id}, ${a?.kind ?? '?'})`);
        }
    }

    console.log(`\n✓ test complete`);
}

main().catch((err) => {
    console.error(`\n✗ test failed:`, err instanceof Error ? err.stack ?? err.message : err);
    Deno.exit(1);
});
