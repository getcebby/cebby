#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-sys --no-config
/**
 * Local end-to-end test for the FB no-token public-scrape strategy against v2.
 * Uses the same facebook-event-scraper lib the fb-scraper Edge Function uses,
 * so a green run here means the deployed function will work.
 *
 * Usage:
 *   deno run --allow-net --allow-env --allow-read --allow-sys --no-config \
 *     services/facebook/scripts/test-scraper-v2.ts
 *
 *   ... --event-id=2017507705688009     # by FB event id
 *   ... --url=https://facebook.com/...  # by full URL
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
// 2. Imports
// =============================================================================

const { createClient } = await import('npm:@supabase/supabase-js@2');
const fbScraper = await import('npm:facebook-event-scraper');
const { scrapeFbEvent, scrapeFbEventFromFbid } = fbScraper;
const ingestModule = await import('../../core/supabase/features/events/index.ts');
const { findOrCreateAccount, ingestEvents, getEventsByIds, storeCoverImages, geocodeEventLocations } = ingestModule;

const v2 = createClient(NEW_URL, NEW_KEY, { auth: { persistSession: false } });


// =============================================================================
// 3. Args
// =============================================================================

interface Args { url?: string; eventId?: string }
function parseArgs(argv: string[]): Args {
    const out: Args = {};
    for (const a of argv) {
        if (a.startsWith('--url=')) out.url = a.slice('--url='.length);
        else if (a.startsWith('--event-id=')) out.eventId = a.slice('--event-id='.length);
    }
    return out;
}
const args = parseArgs(Deno.args);


// =============================================================================
// 4. Pick a target — default to most-recent FB source_link in v2
// =============================================================================

async function pickTarget(): Promise<{ url: string; id: string } | null> {
    if (args.url)     return { url: args.url, id: '' };
    if (args.eventId) return { url: `https://www.facebook.com/events/${args.eventId}`, id: args.eventId };

    const { data, error } = await v2.from('event_source_links')
        .select('source_id, url, scraped_at')
        .eq('source', 'facebook')
        .order('scraped_at', { ascending: false })
        .limit(1)
        .maybeSingle();
    if (error || !data) {
        console.error(`✗ no FB source_links in v2 (err: ${error?.message ?? 'none'})`);
        return null;
    }
    const id = (data as { source_id: string }).source_id;
    return { url: `https://www.facebook.com/events/${id}`, id };
}


// =============================================================================
// 5. buildIngest — mirror of services/facebook/.../fb-scraper/index.ts
// =============================================================================

interface FbHost {
    id: string | number;
    name: string;
    type?: string;
    url?: string;
    photo?: { url?: string };
}
interface FbScrapeData {
    id: string | number;
    name?: string;
    description?: string;
    url?: string;
    timezone?: string;
    startTimestamp?: number;
    endTimestamp?: number;
    location?: {
        name?: string;
        city?: string | null;
        country?: string | null;
        coordinates?: { latitude?: number; longitude?: number };
    };
    photo?: { url?: string };
    hosts?: FbHost[];
}

function isLikelyPage(host: { type?: string; url?: string }): boolean {
    if (host.type === 'Page') return true;
    if (!host.url) return false;
    const path = host.url.replace(/^https?:\/\/(www\.)?facebook\.com\//, '').split('?')[0].replace(/\/+$/, '');
    if (path.startsWith('profile.php')) return false;
    if (/^\d+$/.test(path)) return false;
    return true;
}

async function buildIngest(event: FbScrapeData) {
    const allHosts = event.hosts ?? [];
    const orgHosts = allHosts.filter(isLikelyPage);
    if (orgHosts.length === 0) {
        console.warn(`  • event ${event.id} has no Page-like hosts — skipping`);
        console.warn(`    raw hosts: ${JSON.stringify(allHosts.map((h) => ({ name: h.name, type: h.type, url: (h as { url?: string }).url })))}`);
        return null;
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
    if (organizers.length === 0) {
        console.warn(`  • event ${event.id} — no organizers persisted`);
        return null;
    }

    const startMs = (event.startTimestamp ?? 0) * 1000;
    const endMs = event.endTimestamp ? event.endTimestamp * 1000 : null;
    const hasCoords = event.location?.coordinates?.latitude != null && event.location?.coordinates?.longitude != null;
    const format: 'in_person' | 'online' = hasCoords ? 'in_person' : 'online';

    return {
        name: event.name ?? '(unnamed)',
        description: event.description ?? null,
        start_time: new Date(startMs).toISOString(),
        end_time: endMs ? new Date(endMs).toISOString() : null,
        timezone: event.timezone ?? null,
        format,
        location: event.location?.name ?? null,
        location_details: hasCoords
            ? {
                  latitude: event.location!.coordinates!.latitude!,
                  longitude: event.location!.coordinates!.longitude!,
              }
            : null,
        city: event.location?.city ?? null,
        country: event.location?.country ?? null,
        cover_photo: (event.photo as unknown as { imageUri?: string })?.imageUri
            ?? event.photo?.url
            ?? null,
        source: 'facebook',
        source_id: String(event.id),
        source_url: event.url ?? `https://www.facebook.com/events/${event.id}`,
        ingest_kind: 'public_scrape' as const,
        raw: event as unknown,
        organizers,
    };
}


// =============================================================================
// 6. Main
// =============================================================================

async function main() {
    console.log(`\n=== FB public-scrape (no-token) → v2 ingest test ===`);
    console.log(`v2: ${NEW_URL}\n`);

    const target = await pickTarget();
    if (!target) Deno.exit(1);
    console.log(`target: ${target.url}`);

    console.log(`\n[1/5] scraping FB event...`);
    let event: FbScrapeData;
    try {
        event = (target.id
            ? await scrapeFbEventFromFbid(target.id)
            : await scrapeFbEvent(target.url)) as FbScrapeData;
    } catch (err) {
        console.error(`✗ scrape failed: ${err instanceof Error ? err.message : err}`);
        Deno.exit(1);
    }
    console.log(`  → ${event.name ?? '(no name)'} (id=${event.id})`);
    console.log(`     hosts: ${event.hosts?.length ?? 0} total, ${(event.hosts ?? []).filter((h) => h.type === 'Page').length} Page-type`);
    console.log(`     timezone=${event.timezone ?? '-'}  city=${event.location?.city ?? '-'}`);
    console.log(`     coords=${event.location?.coordinates?.latitude ?? '-'},${event.location?.coordinates?.longitude ?? '-'}`);

    console.log(`\n[2/5] building ingest payload...`);
    const ingest = await buildIngest(event);
    if (!ingest) Deno.exit(1);
    console.log(`     timezone=${ingest.timezone ?? '-'}  format=${ingest.format}  ingest_kind=${ingest.ingest_kind}`);
    console.log(`     city=${ingest.city ?? '-'}  country=${ingest.country ?? '-'}`);
    console.log(`     organizers=${ingest.organizers.length}`);

    console.log(`\n[3/5] running ingestEvents...`);
    const results = await ingestEvents([ingest]);
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
