import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { scrapeFbEvent, scrapeFbEventFromFbid, EventData } from 'facebook-event-scraper';
import {
    geocodeEventLocations,
    getEventsByIds,
    ingestEvents,
    storeCoverImages,
} from '@service/core/supabase/features/events/index.ts';
import { buildIngestFromFbEvent } from '../_shared/events.ts';

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
