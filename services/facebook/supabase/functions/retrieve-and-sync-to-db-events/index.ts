import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { Account, IngestEvent } from '@service/core/supabase/shared/types.ts';
import {
    findOrCreateAccount,
    geocodeEventLocations,
    getEventsByIds,
    ingestEvents,
    storeCoverImages,
} from '@service/core/supabase/features/events/index.ts';
import { retrieveEventsFromFacebook } from '../_shared/events.ts';
import { FacebookCohost, FacebookEvent } from '../_shared/types.ts';

function extractCohosts(event: FacebookEvent): FacebookCohost[] {
    if (!event.cohosts) return [];
    if (Array.isArray(event.cohosts)) return event.cohosts;
    return Array.isArray(event.cohosts.data) ? event.cohosts.data : [];
}

async function processEvents(account: Account) {
    const { account_id, access_token, page_access_token } = account;

    console.log(`[fb-cron] processing events for account: ${account_id}`);

    const pageId = account_id;
    // Adding `cohosts` lets us pick up multi-org joint events (e.g., PizzaPy +
    // JSCebu + AWSUG) at cron time instead of needing the manual fb-scraper.
    const fields = 'id,name,cover,description,created_time,place,start_time,end_time,cohosts';
    const url = `https://graph.facebook.com/v21.0/${pageId}/events?fields=${fields}&access_token=${
        page_access_token || access_token
    }&format=json&method=get`;

    const events = await retrieveEventsFromFacebook(url);
    console.log(`[fb-cron] retrieved ${events.length} events for account: ${account_id}`);

    const ingests = await mapEventsToIngest(events, account);
    const results = await ingestEvents(ingests);
    console.log(
        `[fb-cron] ingested ${results.length} for ${account_id}: ` +
            `${results.filter((r) => r.is_new_event).length} new, ` +
            `${results.filter((r) => !r.is_new_event).length} matched/re-scraped, ` +
            `${results.filter((r) => r.became_canonical).length} became canonical`,
    );

    // Fire-and-forget enrichment — failures here do not block the ingest response.
    const eventRows = await getEventsByIds(results.map((r) => r.event_id));
    await storeCoverImages(eventRows);
    await geocodeEventLocations(eventRows);

    return results;
}

Deno.serve(async (req) => {
    try {
        const account: Account = await req.json();

        // @ts-ignore-next-line
        EdgeRuntime.waitUntil(processEvents(account));

        return new Response(
            JSON.stringify({
                message: `Successfully queued processEvents for account: ${account.account_id}`,
            }),
            {
                headers: { 'Content-Type': 'application/json' },
            },
        );
    } catch (error) {
        console.error('[fb-cron] error processing events:', error);
        return new Response(JSON.stringify({ error: 'Failed to process events' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
});

async function mapEventsToIngest(events: FacebookEvent[], account: Account): Promise<IngestEvent[]> {
    const ownerId = String(account.account_id);
    const ingests: IngestEvent[] = [];

    for (const event of events) {
        // Owning page is always the primary organizer. Cohosts (Page-type
        // entities the event creator added) become co-presenters. Find-or-
        // create each so we satisfy the FK from event_organizers.account_id.
        const organizers: Array<{ account_id: string; role?: string }> = [
            { account_id: ownerId, role: 'presenter' },
        ];

        for (const cohost of extractCohosts(event)) {
            const cohostId = String(cohost.id);
            if (!cohostId || !cohost.name || cohostId === ownerId) continue;

            const cohostAccount = await findOrCreateAccount({
                account_id: cohostId,
                name: cohost.name,
                type: 'facebook',
                // Graph API cohosts on event nodes are pages by definition.
                kind: 'fb_page',
            });
            if (cohostAccount) {
                // Use the resolved account_id (may differ from cohostId when
                // findOrCreateAccount deduped by name to an existing row).
                organizers.push({ account_id: String(cohostAccount.account_id), role: 'presenter' });
            }
        }

        ingests.push({
            name: event.name ?? '(unnamed)',
            description: event.description ?? null,
            start_time: event.start_time,
            end_time: event.end_time ?? null,
            location: event.place?.name ?? null,
            location_details:
                event.place?.location?.latitude != null && event.place?.location?.longitude != null
                    ? {
                          latitude: event.place.location.latitude,
                          longitude: event.place.location.longitude,
                      }
                    : null,
            cover_photo: event.cover?.source ?? null,
            source: 'facebook',
            source_id: String(event.id),
            source_url: `https://www.facebook.com/events/${event.id}`,
            raw: event as unknown,
            organizers,
        });
    }

    return ingests;
}
