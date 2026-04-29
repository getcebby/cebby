#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-sys --no-config
/**
 * Scrape a specific set of FB event IDs and ingest into v2.
 *
 * Useful for plugging gaps surfaced by compare-live-vs-v2.ts: events that
 * existed in v1 LIVE but didn't make it into v2 via the staging migration.
 *
 * Usage:
 *   deno run --allow-net --allow-env --allow-read --allow-sys --no-config \
 *     services/facebook/scripts/scrape-specific-ids.ts \
 *     1312878331048426 1976422669641771 1539040864405680 ...
 *
 * Each id becomes one HTTP scrape + ingest. Failures (event deleted, made
 * private, etc.) are reported and skipped — accepted as historical loss.
 */

import { load } from 'jsr:@std/dotenv@0.225';

const ENV_PATH = new URL('../../core/scripts/.env.migration', import.meta.url).pathname;
const env = await load({ envPath: ENV_PATH, export: false });

const NEW_URL = env.NEW_SUPABASE_URL ?? Deno.env.get('NEW_SUPABASE_URL');
const NEW_KEY = env.NEW_SUPABASE_SERVICE_ROLE_KEY ?? Deno.env.get('NEW_SUPABASE_SERVICE_ROLE_KEY');
if (!NEW_URL || !NEW_KEY) {
    console.error('✗ Missing NEW_SUPABASE_*');
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

const fbScraper = await import('npm:facebook-event-scraper');
const { scrapeFbEventFromFbid } = fbScraper;
const ingestModule = await import('../../core/supabase/features/events/index.ts');
const { findOrCreateAccount, ingestEvents, getEventsByIds, storeCoverImages, geocodeEventLocations } = ingestModule;

interface FbHost { id: string | number; name: string; type?: string; url?: string; photo?: { url?: string } }
function isLikelyPage(host: FbHost): boolean {
    if (host.type === 'Page') return true;
    if (!host.url) return false;
    const path = host.url.replace(/^https?:\/\/(www\.)?facebook\.com\//, '').split('?')[0].replace(/\/+$/, '');
    if (path.startsWith('profile.php')) return false;
    if (/^\d+$/.test(path)) return false;
    return true;
}

const ids = Deno.args.filter((a) => !a.startsWith('--'));
if (ids.length === 0) {
    console.error('Usage: scrape-specific-ids.ts <fb_event_id> [<fb_event_id> ...]');
    Deno.exit(1);
}

console.log(`\n=== scrape-specific-ids: ${ids.length} FB events ===\n`);

let ok = 0, fail = 0;
for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const tag = `[${i + 1}/${ids.length}] fb:${id}`;

    let event: Awaited<ReturnType<typeof scrapeFbEventFromFbid>>;
    try {
        event = await scrapeFbEventFromFbid(id);
    } catch (err) {
        console.warn(`${tag} ✗ scrape failed: ${err instanceof Error ? err.message : err}`);
        fail++;
        if (i < ids.length - 1) await new Promise((r) => setTimeout(r, 2000));
        continue;
    }

    const allHosts = (event.hosts ?? []) as FbHost[];
    const orgHosts = allHosts.filter(isLikelyPage);
    if (orgHosts.length === 0) {
        console.warn(`${tag} ✗ no Page-like hosts`);
        fail++;
        if (i < ids.length - 1) await new Promise((r) => setTimeout(r, 2000));
        continue;
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
        cover_photo: (event as unknown as { photo?: { imageUri?: string; url?: string } }).photo?.imageUri
            ?? (event as unknown as { photo?: { url?: string } }).photo?.url
            ?? null,
        source: 'facebook',
        source_id: String(event.id),
        source_url: (event as unknown as { url?: string }).url ?? `https://www.facebook.com/events/${event.id}`,
        ingest_kind: 'public_scrape' as const,
        raw: event as unknown,
        organizers,
    };

    const results = await ingestEvents([ingest]);
    if (results.length === 0) { console.warn(`${tag} ✗ ingest returned no result`); fail++; continue; }
    const r = results[0];

    try {
        const eventRows = await getEventsByIds([r.event_id]);
        await storeCoverImages(eventRows);
        await geocodeEventLocations(eventRows);
    } catch { /* non-fatal */ }

    console.log(`${tag} ✓ "${event.name}" → event_id=${r.event_id} new=${r.is_new_event} organizers=${organizers.length}`);
    ok++;

    if (i < ids.length - 1) await new Promise((r) => setTimeout(r, 2000));
}

console.log(`\n=== summary ===`);
console.log(`processed: ${ids.length}`);
console.log(`ok:        ${ok}`);
console.log(`failed:    ${fail}`);
