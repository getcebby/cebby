#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-sys --no-config
/**
 * Mass re-scrape every Facebook event in v2 via the no-token strategy.
 *
 * Why: yesterday's backfill captured organizers for events that had none, but
 * many events still have INCOMPLETE attribution (only 1 of 6 actual hosts).
 * Re-scraping with the new URL-shape heuristic + multi-host extraction fills
 * in the rest. Idempotent — Branch 1 (rescrape) updates the source_link and
 * upserts organizers; existing organizers' positions get refreshed to match
 * the live host order.
 *
 * Usage:
 *   deno run --allow-net --allow-env --allow-read --allow-sys --no-config \
 *     services/facebook/scripts/rescrape-all-v2.ts
 *
 *   --limit=N        Process at most N events (test first with --limit=3)
 *   --since=YYYY-MM-DD   Only events with start_time after this date
 *   --gap-ms=N       Polite delay between scrapes (default 2000ms)
 *   --dry-run        List what would be processed; no writes
 */

import { load } from 'jsr:@std/dotenv@0.225';

// =============================================================================
// 1. Env + bind shared client to v2
// =============================================================================

const ENV_PATH = new URL('../../core/scripts/.env.migration', import.meta.url).pathname;
const env = await load({ envPath: ENV_PATH, export: false });

const NEW_URL = env.NEW_SUPABASE_URL ?? Deno.env.get('NEW_SUPABASE_URL');
const NEW_KEY = env.NEW_SUPABASE_SERVICE_ROLE_KEY ?? Deno.env.get('NEW_SUPABASE_SERVICE_ROLE_KEY');
if (!NEW_URL || !NEW_KEY) {
    console.error(`✗ Missing NEW_SUPABASE_* (env: ${ENV_PATH})`);
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
// 2. Imports (after env is bound)
// =============================================================================

const { createClient } = await import('npm:@supabase/supabase-js@2');
const fbScraper = await import('npm:facebook-event-scraper');
const { scrapeFbEventFromFbid } = fbScraper;
const ingestModule = await import('../../core/supabase/features/events/index.ts');
const { findOrCreateAccount, ingestEvents, getEventsByIds, storeCoverImages, geocodeEventLocations } = ingestModule;

const v2 = createClient(NEW_URL, NEW_KEY, { auth: { persistSession: false } });


// =============================================================================
// 3. Args
// =============================================================================

interface Args {
    limit?: number;
    since?: string;
    gapMs: number;
    dryRun: boolean;
}
function parseArgs(argv: string[]): Args {
    const out: Args = { gapMs: 2000, dryRun: false };
    for (const a of argv) {
        if (a.startsWith('--limit=')) out.limit = parseInt(a.slice('--limit='.length), 10);
        else if (a.startsWith('--since=')) out.since = a.slice('--since='.length);
        else if (a.startsWith('--gap-ms=')) out.gapMs = parseInt(a.slice('--gap-ms='.length), 10);
        else if (a === '--dry-run') out.dryRun = true;
    }
    return out;
}
const args = parseArgs(Deno.args);


// =============================================================================
// 4. Page-like host heuristic (mirrors fb-scraper Edge Function)
// =============================================================================

interface FbHost { id: string | number; name: string; type?: string; url?: string; photo?: { url?: string } }

function isLikelyPage(host: FbHost): boolean {
    if (host.type === 'Page') return true;
    if (!host.url) return false;
    const path = host.url.replace(/^https?:\/\/(www\.)?facebook\.com\//, '').split('?')[0].replace(/\/+$/, '');
    if (path.startsWith('profile.php')) return false;
    if (/^\d+$/.test(path)) return false;
    return true;
}


// =============================================================================
// 5. Main loop
// =============================================================================

interface FbLink { id: number; source_id: string; event_id: number; scraped_at: string }

async function loadTargets(): Promise<FbLink[]> {
    // Two-step: events with date filter → source_links via in(). Avoids
    // PostgREST FK ambiguity (events has FKs to event_source_links in both
    // directions: primary_source_link_id one way, source_links→events the other).
    let restrictEventIds: number[] | null = null;
    if (args.since) {
        const { data: eventsAfter, error: ef } = await v2.from('events')
            .select('id')
            .gte('start_time', `${args.since}T00:00:00+00:00`);
        if (ef) {
            console.error('✗ failed to filter events by since:', ef.message);
            Deno.exit(1);
        }
        restrictEventIds = (eventsAfter ?? []).map((e: { id: number }) => e.id);
        if (restrictEventIds.length === 0) {
            console.warn(`(no events with start_time >= ${args.since})`);
            return [];
        }
    }

    let q = v2.from('event_source_links')
        .select('id, source_id, event_id, scraped_at')
        .eq('source', 'facebook')
        .order('scraped_at', { ascending: false });

    if (restrictEventIds) q = q.in('event_id', restrictEventIds);
    if (args.limit)       q = q.limit(args.limit);

    const { data, error } = await q;
    if (error) {
        console.error('✗ failed to load FB source_links:', error.message);
        Deno.exit(1);
    }
    return (data ?? []) as FbLink[];
}

async function rescrapeOne(link: FbLink): Promise<{ ok: boolean; note: string; organizers?: number }> {
    const fbId = link.source_id;

    let event: Awaited<ReturnType<typeof scrapeFbEventFromFbid>>;
    try {
        event = await scrapeFbEventFromFbid(fbId);
    } catch (err) {
        return { ok: false, note: `scrape failed: ${err instanceof Error ? err.message : err}` };
    }

    const allHosts = (event.hosts ?? []) as FbHost[];
    const orgHosts = allHosts.filter(isLikelyPage);
    if (orgHosts.length === 0) {
        return { ok: false, note: `no Page-like hosts (raw types: ${allHosts.map((h) => h.type).join(',')})` };
    }

    const organizers: Array<{ account_id: string; role?: string }> = [];
    for (const host of orgHosts) {
        const acc = await findOrCreateAccount({
            account_id: String(host.id),
            name: host.name,
            type: 'facebook',
            kind: 'fb_page',
            primary_photo: host.photo?.url ?? null,
        });
        if (acc) organizers.push({ account_id: String(acc.account_id), role: 'presenter' });
    }
    if (organizers.length === 0) return { ok: false, note: 'no organizers persisted' };

    const startMs = ((event.startTimestamp as number | undefined) ?? 0) * 1000;
    const endMs = (event.endTimestamp as number | undefined) ? (event.endTimestamp as number) * 1000 : null;
    const loc = (event as unknown as { location?: { name?: string; city?: string | null; country?: string | null; coordinates?: { latitude?: number; longitude?: number } } }).location;
    const hasCoords = loc?.coordinates?.latitude != null && loc?.coordinates?.longitude != null;

    const ingest = {
        name: event.name ?? '(unnamed)',
        description: (event as unknown as { description?: string }).description ?? null,
        start_time: new Date(startMs).toISOString(),
        end_time: endMs ? new Date(endMs).toISOString() : null,
        timezone: (event as unknown as { timezone?: string }).timezone ?? null,
        format: (hasCoords ? 'in_person' : 'online') as 'in_person' | 'online',
        location: loc?.name ?? null,
        location_details: hasCoords ? { latitude: loc!.coordinates!.latitude!, longitude: loc!.coordinates!.longitude! } : null,
        city: loc?.city ?? null,
        country: loc?.country ?? null,
        cover_photo: (event as unknown as { photo?: { url?: string } }).photo?.url ?? null,
        source: 'facebook',
        source_id: String(event.id),
        source_url: (event as unknown as { url?: string }).url ?? `https://www.facebook.com/events/${event.id}`,
        ingest_kind: 'public_scrape' as const,
        raw: event as unknown,
        organizers,
    };

    if (args.dryRun) {
        return { ok: true, note: `[DRY] would re-ingest with ${organizers.length} organizers`, organizers: organizers.length };
    }

    const results = await ingestEvents([ingest]);
    if (results.length === 0) return { ok: false, note: 'ingestEvents returned no result' };
    const r = results[0];

    // Best-effort enrichment — non-fatal.
    try {
        const eventRows = await getEventsByIds([r.event_id]);
        await storeCoverImages(eventRows);
        await geocodeEventLocations(eventRows);
    } catch { /* ignore */ }

    return {
        ok: true,
        note: `event_id=${r.event_id} new=${r.is_new_event} canonical=${r.became_canonical}`,
        organizers: organizers.length,
    };
}

async function main() {
    console.log(`\n=== FB mass re-scrape against v2 ===`);
    console.log(`v2: ${NEW_URL}`);
    console.log(`mode: ${args.dryRun ? 'DRY RUN' : 'LIVE'}`);
    console.log(`gap: ${args.gapMs}ms between scrapes`);
    if (args.limit) console.log(`limit: ${args.limit}`);
    if (args.since) console.log(`since: events with start_time >= ${args.since}`);

    const links = await loadTargets();
    console.log(`\n${links.length} FB source_links to process\n`);

    const summary = { ok: 0, failed: 0, total_organizers: 0 };
    const failures: Array<{ source_id: string; note: string }> = [];

    for (let i = 0; i < links.length; i++) {
        const link = links[i];
        const tag = `[${i + 1}/${links.length}] fb:${link.source_id}`;
        const result = await rescrapeOne(link);
        if (result.ok) {
            summary.ok++;
            summary.total_organizers += result.organizers ?? 0;
            console.log(`${tag} ✓ ${result.note}`);
        } else {
            summary.failed++;
            failures.push({ source_id: link.source_id, note: result.note });
            console.warn(`${tag} ✗ ${result.note}`);
        }

        // Polite gap so FB doesn't rate-limit us. Skip the gap on the last one.
        if (i < links.length - 1) {
            await new Promise((r) => setTimeout(r, args.gapMs));
        }
    }

    console.log(`\n=== summary ===`);
    console.log(`processed:        ${links.length}`);
    console.log(`successful:       ${summary.ok}`);
    console.log(`failed:           ${summary.failed}`);
    console.log(`total organizers: ${summary.total_organizers}`);
    console.log(`avg per event:    ${summary.ok > 0 ? (summary.total_organizers / summary.ok).toFixed(1) : 0}`);

    if (failures.length > 0) {
        console.log(`\nfailures:`);
        for (const f of failures) console.log(`  fb:${f.source_id} — ${f.note}`);
    }
}

main().catch((err) => {
    console.error('\n✗ rescrape failed:', err instanceof Error ? err.stack ?? err.message : err);
    Deno.exit(1);
});
