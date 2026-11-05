import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { handleLinkCheck } from '@service/core/supabase/shared/link-check-endpoint.ts';
import { parseEventbriteEventUrl, probeEventbriteEventPage } from '../_shared/eventbriteutils.ts';
import { importEventbriteEvent } from '../_shared/import-event.ts';

/**
 * Manual single-URL Eventbrite ingest, the target of admin `/api/scrape`
 * (source=eventbrite). The organizer sync (retrieve-and-sync-to-db-eventbrite-events)
 * imports discovered dates through the same importEventbriteEvent.
 */

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
    if (req.method !== 'POST') {
        return new Response('Method not allowed', { status: 405 });
    }

    try {
        const body = await req.json().catch(() => null) as { url?: string; mode?: string } | null;

        // Hourly link check (pg_cron): reads the database's own sample events, saves nothing.
        if (body?.mode === 'check') {
            return await handleLinkCheck('eventbrite', probeEventbriteEventPage);
        }

        const url = body?.url?.trim() ?? '';
        if (!url) return json({ error: 'URL is required' }, 400);

        const parsed = parseEventbriteEventUrl(url);
        if (!parsed) {
            return json({ error: 'Expected an Eventbrite event URL like https://www.eventbrite.com/e/<slug>-<id>' }, 400);
        }

        const outcome = await importEventbriteEvent(parsed.canonicalUrl);
        switch (outcome.kind) {
            case 'not_found':
                return json({ error: `No Eventbrite event found at ${parsed.canonicalUrl}` }, 404);
            case 'series_parent':
                return json({
                    error:
                        `"${outcome.name}" is an Eventbrite series page, not a single date. Open the date you want on Eventbrite and paste that URL.`,
                    series_id: outcome.seriesId,
                }, 422);
            case 'organizer_failed':
                return json({ error: `Could not save organizer ${outcome.organizer}` }, 500);
            case 'skipped':
                return json({ error: `Skipped: ${outcome.reason}` }, 422);
            case 'imported':
                return json({ message: 'Event processed', result: outcome.result });
        }
    } catch (error) {
        console.error('[eventbrite-scraper] error:', error);
        return json({ error: error instanceof Error ? error.message : String(error) }, 500);
    }
});
