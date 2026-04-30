#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-sys --no-config
/**
 * Local end-to-end test for Luma ingest against the v2 database.
 *
 * What it does:
 *   1. Loads v2 credentials from services/core/scripts/.env.migration
 *   2. Points the shared supabase client at v2 (via env vars)
 *   3. Reads a Luma account from v2 (default: aicebucommunity, --account=<x>)
 *   4. Fetches that account's upcoming events from Luma
 *   5. Runs them through ingestEvents (same code the Edge Function calls)
 *   6. Prints exactly what was written: events / source links / organizers
 *
 * Goal: tight feedback loop for verifying Luma → v2 works before deploy.
 *
 * Usage:
 *   deno run --allow-net --allow-env --allow-read --allow-sys --no-config \
 *     services/luma/scripts/test-ingest-v2.ts                  # default account
 *
 *   deno run --allow-net --allow-env --allow-read --allow-sys --no-config \
 *     services/luma/scripts/test-ingest-v2.ts --account=goab   # by discovery_path
 *
 *   ... --account-id=cal-aRvpGAFjQUoFt3f                       # by account_id
 *
 *   ... --event=GOABS13                                        # single event backfill
 */

import { load } from 'jsr:@std/dotenv@0.225';

// =============================================================================
// 1. Load env + point shared client at v2 BEFORE any imports that read env
// =============================================================================

const ENV_PATH = new URL('../../core/scripts/.env.migration', import.meta.url).pathname;
const env = await load({ envPath: ENV_PATH, export: false });

const NEW_URL = env.NEW_SUPABASE_URL ?? Deno.env.get('NEW_SUPABASE_URL');
const NEW_KEY = env.NEW_SUPABASE_SERVICE_ROLE_KEY ?? Deno.env.get('NEW_SUPABASE_SERVICE_ROLE_KEY');

if (!NEW_URL || !NEW_KEY) {
    console.error(`✗ Missing NEW_SUPABASE_URL / NEW_SUPABASE_SERVICE_ROLE_KEY (env: ${ENV_PATH})`);
    Deno.exit(1);
}

// shared/client.ts reads these at module load time. Set BEFORE the dynamic
// import below so the imported supabase client connects to v2.
Deno.env.set('SUPABASE_URL', NEW_URL);
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', NEW_KEY);

// Pass through R2 credentials so storeCoverImages re-hosts to R2 locally
// (mirrors the Edge Function secrets that will be set on deploy).
const r2Vars = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'R2_PUBLIC_URL'];
for (const k of r2Vars) {
    const v = env[k] ?? Deno.env.get(k);
    if (v) Deno.env.set(k, v);
}

// Optional: pass through GOOGLE_MAPS_KEY if defined locally so geocoding works.
const gmaps = env.GOOGLE_MAPS_KEY ?? Deno.env.get('GOOGLE_MAPS_KEY');
if (gmaps) Deno.env.set('GOOGLE_MAPS_KEY', gmaps);

// =============================================================================
// 2. Dynamic imports (now bound to v2 via env)
// =============================================================================

const { createClient } = await import('npm:@supabase/supabase-js@2');
const { fetchEventsForLumaPath, fetchLumaEvent } = await import('../supabase/functions/_shared/lumautils.ts');
const ingestModule = await import('../../core/supabase/features/events/index.ts');
const { findOrCreateAccount, ingestEvents, getEventsByIds, storeCoverImages, geocodeEventLocations } = ingestModule;

// Type fragments — full Database types not regenerated yet.
type LumaEvent = Awaited<ReturnType<typeof fetchEventsForLumaPath>>[number];

const v2 = createClient(NEW_URL, NEW_KEY, { auth: { persistSession: false } });

// =============================================================================
// 3. Args
// =============================================================================

interface Args {
    account?: string; // by discovery_path
    accountId?: string; // by account_id
    event?: string; // single Luma event path or URL
    all: boolean; // iterate every active Luma account
}
function parseArgs(argv: string[]): Args {
    const out: Args = { all: false };
    for (const a of argv) {
        if (a.startsWith('--account=')) out.account = a.slice('--account='.length);
        else if (a.startsWith('--account-id=')) out.accountId = a.slice('--account-id='.length);
        else if (a.startsWith('--event=')) out.event = a.slice('--event='.length);
        else if (a === '--all') out.all = true;
    }
    return out;
}
const args = parseArgs(Deno.args);

// =============================================================================
// 4. Pick the account
// =============================================================================

interface AccountRow {
    account_id: string;
    name: string | null;
    type: string;
    kind: string;
    discovery_path: string | null;
    organization_id: number | null;
}

async function pickAccount(): Promise<AccountRow | null> {
    let query = v2.from('accounts').select('account_id,name,type,kind,discovery_path,organization_id').eq(
        'type',
        'luma',
    ).eq('is_active', true);

    if (args.accountId) query = query.eq('account_id', args.accountId);
    else if (args.account) query = query.eq('discovery_path', args.account);
    else query = query.eq('discovery_path', 'aicebucommunity');

    const { data, error } = await query.maybeSingle();
    if (error) {
        console.error(`✗ failed to read accounts: ${error.message}`);
        return null;
    }
    return data as AccountRow | null;
}

async function listAllLumaAccounts(): Promise<AccountRow[]> {
    const { data, error } = await v2
        .from('accounts')
        .select('account_id,name,type,kind,discovery_path,organization_id')
        .eq('type', 'luma')
        .eq('is_active', true)
        .not('discovery_path', 'is', null)
        .order('name');
    if (error) {
        console.error(`✗ failed to list accounts: ${error.message}`);
        return [];
    }
    return (data ?? []) as AccountRow[];
}

// =============================================================================
// 5. Mirror of buildIngestForCalendarEvent from the Edge Function
//    (kept inline so we don't depend on the function module's top-level Deno.serve)
// =============================================================================

async function buildIngest(event: LumaEvent) {
    const presenters = event.presenters.length > 0 ? event.presenters : event.presenter ? [event.presenter] : [];
    if (presenters.length === 0) {
        console.warn(`  • event ${event.api_id} has no Presented by attribution — ingesting without organizers`);
    }

    const organizers = [];
    for (const presenter of presenters) {
        const account = await findOrCreateAccount({
            account_id: presenter.api_id,
            name: presenter.name,
            type: 'luma',
            kind: presenter.kind,
            primary_photo: presenter.avatar,
        });
        if (!account) {
            console.warn(`  • event ${event.api_id} — could not persist presenter account ${presenter.api_id}`);
            continue;
        }
        organizers.push({ account_id: presenter.api_id, role: 'presenter' });
    }
    if (presenters.length > 0 && organizers.length === 0) {
        console.warn(`  • event ${event.api_id} — could not persist any presenter accounts`);
        return null;
    }

    const format: 'in_person' | 'online' = event.location_type && event.location_type !== 'offline'
        ? 'online'
        : 'in_person';

    return {
        name: event.name,
        description: event.description,
        start_time: event.start_time,
        end_time: event.end_time,
        timezone: event.timezone,
        format,
        location: event.location,
        location_details: event.location_details,
        city: event.city,
        region: event.region,
        country: event.country,
        cover_photo: event.cover_photo,
        source: 'luma',
        source_id: event.api_id,
        source_url: event.url,
        ingest_kind: 'public_scrape' as const,
        raw: event as unknown,
        organizers,
    };
}

// =============================================================================
// 6. Main
// =============================================================================

interface AccountSummary {
    name: string;
    fetched: number;
    ingested: number;
    skipped: number;
    error?: string;
}

async function processOneAccount(account: AccountRow, verbose: boolean): Promise<AccountSummary> {
    const summary: AccountSummary = { name: account.name ?? '(unnamed)', fetched: 0, ingested: 0, skipped: 0 };

    if (!account.discovery_path) {
        summary.error = 'no discovery_path';
        return summary;
    }

    if (verbose) {
        console.log(`account: ${account.name} (${account.account_id})`);
        console.log(`  kind: ${account.kind}`);
        console.log(`  discovery_path: ${account.discovery_path}`);
    }

    try {
        const events = await fetchEventsForLumaPath(account.discovery_path);
        summary.fetched = events.length;
        if (events.length === 0) return summary;

        const ingests = [];
        for (const e of events) {
            const ig = await buildIngest(e);
            if (ig) ingests.push(ig);
            else summary.skipped++;
        }

        if (ingests.length === 0) return summary;

        const results = await ingestEvents(ingests);
        summary.ingested = results.length;

        // Enrichment per cron's behavior — covers + geocode.
        const eventIds = results.map((r) => r.event_id);
        const eventRows = await getEventsByIds(eventIds);
        await storeCoverImages(eventRows);
        await geocodeEventLocations(eventRows);

        if (verbose) {
            for (const r of results) {
                console.log(`  → event_id=${r.event_id} new=${r.is_new_event} canonical=${r.became_canonical}`);
            }
        }
    } catch (err) {
        summary.error = err instanceof Error ? err.message : String(err);
    }

    return summary;
}

async function main() {
    console.log(`\n=== Luma → v2 ingest test ===`);
    console.log(`v2: ${NEW_URL}\n`);

    if (args.event) {
        console.log(`event: ${args.event}`);
        console.log(`\n[1/5] fetching event from Luma...`);
        const event = await fetchLumaEvent(args.event);
        if (!event) {
            console.error(`✗ no Luma event found for ${args.event}`);
            Deno.exit(1);
        }
        console.log(
            `  → ${event.api_id} "${event.name}" — presenters=${
                event.presenters.map((p) => p.name).join(', ') || '(none)'
            }`,
        );

        console.log(`\n[2/5] building ingest payload...`);
        const ingest = await buildIngest(event);
        if (!ingest) {
            console.error(`✗ event has no ingestable presenter`);
            Deno.exit(1);
        }
        console.log(
            `     timezone=${ingest.timezone ?? '(null)'}  format=${ingest.format ?? '(null)'}  ingest_kind=${
                ingest.ingest_kind ?? '(null)'
            }`,
        );
        console.log(
            `     city=${ingest.city ?? '-'}  region=${ingest.region ?? '-'}  country=${ingest.country ?? '-'}`,
        );

        console.log(`\n[3/5] running ingestEvents...`);
        const results = await ingestEvents([ingest]);
        for (const r of results) {
            console.log(
                `  → event_id=${r.event_id} new=${r.is_new_event} ` +
                    `canonical=${r.became_canonical} match_score=${r.match_score?.toFixed(3) ?? 'n/a'}`,
            );
        }
        if (results.length === 0) {
            console.error(`✗ ingest returned no result`);
            Deno.exit(1);
        }

        console.log(`\n[4/5] running enrichment (storeCoverImages + geocode)...`);
        const eventIds = results.map((r) => r.event_id);
        const eventRowsForEnrichment = await getEventsByIds(eventIds);
        const coverResult = await storeCoverImages(eventRowsForEnrichment);
        console.log(
            `  cover: processed ${coverResult.processedImages}/${coverResult.totalImages} (errors: ${
                coverResult.error ? 'yes' : 'none'
            })`,
        );
        await geocodeEventLocations(eventRowsForEnrichment);

        console.log(`\n[5/5] verifying final v2 state...`);
        await printFinalState(eventIds);
        console.log(`\n✓ test complete`);
        return;
    }

    if (args.all) {
        const accounts = await listAllLumaAccounts();
        console.log(`Backfilling ${accounts.length} active Luma account(s)\n`);

        const summaries: AccountSummary[] = [];
        for (let i = 0; i < accounts.length; i++) {
            const a = accounts[i];
            console.log(`[${i + 1}/${accounts.length}] ${a.name} (path=${a.discovery_path})`);
            const s = await processOneAccount(a, false);
            summaries.push(s);
            const status = s.error
                ? `✗ ${s.error}`
                : `fetched=${s.fetched} ingested=${s.ingested}${s.skipped ? ` skipped=${s.skipped}` : ''}`;
            console.log(`   ${status}`);
        }

        const totals = summaries.reduce(
            (acc, s) => {
                acc.fetched += s.fetched;
                acc.ingested += s.ingested;
                acc.skipped += s.skipped;
                if (s.error) acc.errors += 1;
                return acc;
            },
            { fetched: 0, ingested: 0, skipped: 0, errors: 0 },
        );
        console.log(`\n=== summary ===`);
        console.log(`accounts: ${accounts.length}`);
        console.log(`fetched events: ${totals.fetched}`);
        console.log(`ingested: ${totals.ingested}`);
        console.log(`skipped (no presenter): ${totals.skipped}`);
        console.log(`errors: ${totals.errors}`);
        return;
    }

    const account = await pickAccount();
    if (!account) {
        console.error(`✗ No matching active Luma account found in v2`);
        if (args.account) console.error(`   tried discovery_path = "${args.account}"`);
        else if (args.accountId) console.error(`   tried account_id = "${args.accountId}"`);
        else console.error(`   tried discovery_path = "aicebucommunity" (default)`);
        Deno.exit(1);
    }

    console.log(`account: ${account.name} (${account.account_id})`);
    console.log(`  kind: ${account.kind}`);
    console.log(`  discovery_path: ${account.discovery_path ?? '(none)'}`);
    if (!account.discovery_path) {
        console.error(`✗ account has no discovery_path — nothing to scrape`);
        Deno.exit(1);
    }

    console.log(`\n[1/4] fetching events from Luma...`);
    const events = await fetchEventsForLumaPath(account.discovery_path);
    console.log(`  → got ${events.length} upcoming event(s)`);
    for (const e of events) {
        console.log(
            `    • ${e.api_id} "${e.name}" — presenters=${e.presenters.map((p) => p.name).join(', ') || '(none)'}`,
        );
    }

    if (events.length === 0) {
        console.log(`\n(nothing to ingest — Luma reported no upcoming events)`);
        return;
    }

    console.log(`\n[2/4] building ingest payloads...`);
    const ingests = [];
    for (const e of events) {
        const ingest = await buildIngest(e);
        if (ingest) ingests.push(ingest);
    }
    console.log(`  → ${ingests.length} ready to ingest`);
    for (const ig of ingests) {
        console.log(`     name=${ig.name}`);
        console.log(
            `     timezone=${ig.timezone ?? '(null)'}  format=${ig.format ?? '(null)'}  ingest_kind=${
                ig.ingest_kind ?? '(null)'
            }`,
        );
        console.log(`     city=${ig.city ?? '-'}  region=${ig.region ?? '-'}  country=${ig.country ?? '-'}`);
    }

    console.log(`\n[3/4] running ingestEvents...`);
    const results = await ingestEvents(ingests);
    for (const r of results) {
        console.log(
            `  → event_id=${r.event_id} new=${r.is_new_event} ` +
                `canonical=${r.became_canonical} match_score=${r.match_score?.toFixed(3) ?? 'n/a'}`,
        );
    }

    // Run enrichment (R2 cover re-host + geocode) BEFORE verify so the
    // verification queries reflect the final state the user would see.
    console.log(`\n[4/4] running enrichment (storeCoverImages + geocode)...`);
    const eventIds = results.map((r) => r.event_id);
    const eventRowsForEnrichment = await getEventsByIds(eventIds);
    const coverResult = await storeCoverImages(eventRowsForEnrichment);
    console.log(
        `  cover: processed ${coverResult.processedImages}/${coverResult.totalImages} (errors: ${
            coverResult.error ? 'yes' : 'none'
        })`,
    );
    await geocodeEventLocations(eventRowsForEnrichment);

    console.log(`\n[5/5] verifying final v2 state...`);

    await printFinalState(eventIds);

    console.log(`\n✓ test complete`);
}

async function printFinalState(eventIds: number[]): Promise<void> {
    for (const eventId of eventIds) {
        // Three separate queries so PostgREST FK ambiguity (events has FKs in
        // both directions w/ event_source_links) can't silently return empty.
        const [evRes, linksRes, orgRes] = await Promise.all([
            v2.from('events')
                .select(
                    'id, name, status, format, timezone, city, region, country, start_time, end_time, location, location_details, cover_photo, primary_source_link_id, slug',
                )
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

        if (evRes.error) console.error(`  events query error: ${evRes.error.message}`);
        if (linksRes.error) console.error(`  event_source_links query error: ${linksRes.error.message}`);
        if (orgRes.error) console.error(`  event_organizers query error: ${orgRes.error.message}`);

        const ev = evRes.data as {
            id: number;
            name: string;
            status: string;
            format: string;
            timezone: string | null;
            city: string | null;
            region: string | null;
            country: string | null;
            start_time: string;
            end_time: string | null;
            location: string | null;
            location_details: { latitude: number; longitude: number } | null;
            cover_photo: string | null;
            primary_source_link_id: number | null;
            slug: string | null;
        } | null;
        const links = (linksRes.data ?? []) as Array<
            { id: number; source: string; source_id: string; url: string | null; ingest_kind: string }
        >;
        const orgs = (orgRes.data ?? []) as unknown as Array<
            {
                role: string;
                position: number;
                account_id: string;
                accounts: { account_id: string; name: string; kind: string; organization_id: number | null } | null;
            }
        >;

        console.log(`\n  event #${eventId}:`);
        if (!ev) {
            console.log(`    (✗ not found in events table — something is off)`);
            continue;
        }
        console.log(`    name=${ev.name}`);
        console.log(`    slug=${ev.slug ?? '(none)'}`);
        console.log(`    status=${ev.status}  format=${ev.format}  timezone=${ev.timezone ?? '(null)'}`);
        console.log(`    geo: city=${ev.city ?? '-'}  region=${ev.region ?? '-'}  country=${ev.country ?? '-'}`);
        console.log(`    start=${ev.start_time}  end=${ev.end_time ?? '(none)'}`);
        console.log(`    location=${ev.location ?? '(none)'}`);
        console.log(
            `    coords=${
                ev.location_details ? `${ev.location_details.latitude}, ${ev.location_details.longitude}` : '(none)'
            }`,
        );
        console.log(`    cover=${ev.cover_photo ?? '(none)'}`);
        console.log(`    primary_source_link_id=${ev.primary_source_link_id ?? '(null)'}`);

        console.log(`    source_links (${links.length}):`);
        for (const l of links) {
            const isCanon = l.id === ev.primary_source_link_id ? '★ ' : '  ';
            console.log(`      ${isCanon}#${l.id} ${l.source}:${l.source_id}  ingest=${l.ingest_kind}`);
        }

        console.log(`    organizers (${orgs.length}):`);
        for (const o of orgs) {
            const a = o.accounts;
            console.log(
                `      pos=${o.position} role=${o.role} → ${a?.name ?? '(missing account)'} (${o.account_id}, ${
                    a?.kind ?? '?'
                })`,
            );
        }
    }
}

main().catch((err) => {
    console.error(`\n✗ test failed:`, err instanceof Error ? err.stack ?? err.message : err);
    Deno.exit(1);
});
