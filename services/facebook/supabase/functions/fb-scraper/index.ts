import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { scrapeFbEvent, scrapeFbEventFromFbid, EventData } from 'facebook-event-scraper';
import {
    findOrCreateAccount,
    geocodeEventLocations,
    getEventsByIds,
    ingestEvents,
    storeCoverImages,
} from '@service/core/supabase/features/events/index.ts';
import { IngestEvent } from '@service/core/supabase/shared/types.ts';
import { hostsFromPublicScrape } from '../_shared/organizers.ts';

async function buildIngestFromFbEvent(event: EventData): Promise<IngestEvent | null> {
    const allHosts = event.hosts ?? [];
    // Filter to entity-like hosts (Pages / communities / businesses).
    // Individual user hosts ("Hosted by John Smith") are FB metadata only —
    // surfaced via the deep-link to FB, not promoted to Cebby's organizers.
    const orgHosts = hostsFromPublicScrape(event);
    if (orgHosts.length === 0) {
        console.warn(
            `[fb-scraper] event ${event.id} has no Page-type hosts ` +
                `(${allHosts.length} total host(s); individuals only) — skipping`,
        );
        return null;
    }

    // Find-or-create an accounts row for every Page-type host. New cohost
    // discoveries appear as bare account rows that an admin can later group
    // under an organization (and grant FB tokens to if you want them in the
    // cron sync).
    const organizers: Array<{ account_id: string; role?: string }> = [];
    for (const host of orgHosts) {
        const account = await findOrCreateAccount({
            account_id: String(host.id),
            name: host.name,
            type: 'facebook',
            // URL-derived: anything filtered through isLikelyPage above is
            // treated as a Page-like entity regardless of host.type's label.
            kind: 'fb_page',
            primary_photo: host.photoUrl ?? null,
        });
        if (account) {
            // Use the resolved account_id (may differ from host.id when
            // findOrCreateAccount deduped by name to an existing row).
            organizers.push({ account_id: String(account.account_id), role: 'presenter' });
        }
    }
    if (organizers.length === 0) {
        console.warn(`[fb-scraper] event ${event.id} — no organizers could be persisted`);
        return null;
    }

    const startMs = (event.startTimestamp ?? 0) * 1000;
    const endMs = event.endTimestamp ? event.endTimestamp * 1000 : null;

    return {
        name: event.name ?? '(unnamed)',
        description: event.description ?? null,
        start_time: new Date(startMs).toISOString(),
        end_time: endMs ? new Date(endMs).toISOString() : null,
        // facebook-event-scraper exposes timezone as a string on event.
        timezone: (event as unknown as { timezone?: string }).timezone ?? null,
        // Heuristic — coords present = in_person, otherwise online.
        format: (event.location?.coordinates?.latitude != null
            ? 'in_person'
            : 'online') as 'in_person' | 'online',
        location: event.location?.name ?? null,
        location_details:
            event.location?.coordinates?.latitude != null &&
            event.location?.coordinates?.longitude != null
                ? {
                      latitude: event.location.coordinates.latitude,
                      longitude: event.location.coordinates.longitude,
                  }
                : null,
        // facebook-event-scraper exposes city/country on event.location depending
        // on the page's HTML structure. Pull defensively — these may be undefined
        // for some events. Cast through unknown since the lib's types vary.
        city: (event.location as unknown as { city?: string | null })?.city ?? null,
        country: (event.location as unknown as { country?: string | null })?.country ?? null,
        // event.photo.url is a facebook.com/photo/?fbid=... PAGE URL (HTML),
        // not the image. event.photo.imageUri is the actual CDN URL — use
        // that. Falling back to .url for safety in case the lib's shape ever
        // shifts.
        cover_photo: (event.photo as unknown as { imageUri?: string })?.imageUri
            ?? event.photo?.url
            ?? null,
        source: 'facebook',
        source_id: String(event.id),
        source_url: event.url ?? `https://www.facebook.com/events/${event.id}`,
        // Public HTML scrape (no token) — public_scrape tier.
        ingest_kind: 'public_scrape',
        raw: event as unknown,
        organizers,
        organizer_write_mode: 'replace',
    };
}

async function processEvent({ url, id }: { url: string; id: string }) {
    if (!url && !id) {
        throw new Error('URL and ID are required');
    }

    // Differentiated failure modes — the admin surfaces the specific reason
    // verbatim instead of guessing among 3 causes after the fact:
    //   • throw on transient/unrecoverable scrape errors (rate-limit, 4xx, 5xx)
    //   • throw on "event has only individual hosts" (permanent — Cebby skips
    //     individual-host events on purpose; the user needs to know we won't ingest)
    //   • return null only if ingestEvents itself returned nothing (the matcher
    //     failed silently — caller can retry)
    let event: EventData;
    try {
        event = id ? await scrapeFbEventFromFbid(id) : await scrapeFbEvent(url);
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[fb-scraper] scrape failed:', msg);
        throw new Error(
            `Facebook page scrape failed: ${msg}. ` +
                `Common cause: FB rate-limited the public scrape — wait ~30s and retry. ` +
                `If it persists, the event may be private, deleted, or the URL is wrong.`,
        );
    }
    console.log(`[fb-scraper] scraped: ${event.name} (${event.id}) — ${event.hosts?.length ?? 0} host(s)`);

    const ingest = await buildIngestFromFbEvent(event);
    if (!ingest) {
        const allHosts = event.hosts ?? [];
        const hostNames = allHosts.map((h) => h.name).filter(Boolean).join(', ');
        throw new Error(
            `Event "${event.name}" has no Page-type hosts ` +
                `(${allHosts.length} host(s): ${hostNames || 'none'}). ` +
                `Cebby only ingests events hosted by Pages/communities; individual-host events are skipped by design.`,
        );
    }

    const results = await ingestEvents([ingest]);
    if (results.length === 0) {
        console.error('[fb-scraper] ingest returned no result');
        return null;
    }
    const result = results[0];
    console.log(
        `[fb-scraper] event_id=${result.event_id} new=${result.is_new_event} ` +
            `canonical=${result.became_canonical} score=${result.match_score ?? 'n/a'}`,
    );

    const eventRows = await getEventsByIds([result.event_id]);
    await storeCoverImages(eventRows);
    await geocodeEventLocations(eventRows);

    return result;
}

Deno.serve(async (req) => {
    if (req.method !== 'POST') {
        return new Response('Method not allowed', { status: 405 });
    }

    try {
        const { url, id } = await req.json();
        console.log('[fb-scraper] url:', url, 'id:', id);

        // Synchronous so admin / one-shot callers get the IngestResult back
        // and can redirect straight to the new event. processEvent already
        // returns null for "scraped fine but skipped" cases (no Page-type
        // hosts, no event found); we surface that distinction in the body.
        const result = await processEvent({ url, id });
        return new Response(JSON.stringify({ message: 'Event processed', result }), {
            headers: { 'Content-Type': 'application/json' },
        });
    } catch (error) {
        console.error('[fb-scraper] error processing event:', error);
        return new Response(
            JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
            { status: 500, headers: { 'Content-Type': 'application/json' } },
        );
    }
});
