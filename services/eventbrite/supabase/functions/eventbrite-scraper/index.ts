import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import {
    findOrCreateAccount,
    geocodeEventLocations,
    getEventsByIds,
    ingestEvents,
    storeCoverImages,
} from '@service/core/supabase/features/events/index.ts';
import { fetchEventbriteEvent, parseEventbriteEventUrl, toIngestEvent } from '../_shared/eventbriteutils.ts';
import { EventbriteAccountDetails, EventbriteEvent } from '../_shared/types.ts';

/**
 * Manual single-URL Eventbrite ingest. Wire-up target for admin `/api/scrape`
 * (source=eventbrite). Organizer calendar sync is still a scaffold — see
 * retrieve-and-sync-to-db-eventbrite-events.
 */

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

async function resolveOrganizer(event: EventbriteEvent): Promise<string | null> {
    const details: EventbriteAccountDetails = {
        path: event.organizer.path,
        organizer_id: event.organizer.account_id,
    };
    const account = await findOrCreateAccount({
        account_id: event.organizer.account_id,
        name: event.organizer.name,
        type: 'eventbrite',
        kind: 'eventbrite_organizer',
        primary_photo: event.organizer.avatar,
        account_details: details as unknown as Record<string, string>,
    });
    if (!account) return null;
    // account_id is unique across platforms, and Eventbrite organizer ids are
    // numeric like Facebook page ids. Never attach events to another
    // platform's account on an id collision.
    if (account.type !== 'eventbrite') {
        console.error(
            `[eventbrite-scraper] organizer id ${event.organizer.account_id} matches a ${account.type} account — refusing to attach`,
        );
        return null;
    }
    return account.account_id;
}

Deno.serve(async (req) => {
    if (req.method !== 'POST') {
        return new Response('Method not allowed', { status: 405 });
    }

    try {
        const body = await req.json().catch(() => null) as { url?: string } | null;
        const url = body?.url?.trim() ?? '';
        if (!url) return json({ error: 'URL is required' }, 400);

        const parsed = parseEventbriteEventUrl(url);
        if (!parsed) {
            return json({ error: 'Expected an Eventbrite event URL like https://www.eventbrite.com/e/<slug>-<id>' }, 400);
        }

        const page = await fetchEventbriteEvent(parsed.canonicalUrl);
        if (!page) return json({ error: `No Eventbrite event found at ${parsed.canonicalUrl}` }, 404);
        if (page.kind === 'series_parent') {
            return json({
                error:
                    `"${page.name}" is an Eventbrite series page, not a single date. Open the date you want on Eventbrite and paste that URL.`,
                series_id: page.seriesId,
            }, 422);
        }

        const event = page.event;
        console.log(
            `[eventbrite-scraper] scraped: ${event.name} (${event.eventbrite_id}) — organizer=${event.organizer.name} (${event.organizer.account_id})`,
        );

        const organizerId = await resolveOrganizer(event);
        if (!organizerId) return json({ error: `Could not save organizer ${event.organizer.name}` }, 500);

        const results = await ingestEvents([toIngestEvent(event, organizerId)]);
        const result = results[0];
        if (!result) return json({ error: 'Ingest returned no result' }, 500);
        console.log(
            `[eventbrite-scraper] event_id=${result.event_id} new=${result.is_new_event} ` +
                `canonical=${result.became_canonical} score=${result.match_score ?? 'n/a'}`,
        );

        const eventRows = await getEventsByIds([result.event_id]);
        await storeCoverImages(eventRows);
        await geocodeEventLocations(eventRows);

        return json({ message: 'Event processed', result });
    } catch (error) {
        console.error('[eventbrite-scraper] error:', error);
        return json({ error: error instanceof Error ? error.message : String(error) }, 500);
    }
});
