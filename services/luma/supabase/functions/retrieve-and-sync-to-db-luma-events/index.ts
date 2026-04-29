import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { Account, IngestEvent } from '@service/core/supabase/shared/types.ts';
import {
    findOrCreateAccount,
    geocodeEventLocations,
    getEventsByIds,
    ingestEvents,
    storeCoverImages,
} from '@service/core/supabase/features/events/index.ts';
import { fetchEventsForLumaPath } from '../_shared/lumautils.ts';
import { LumaAccountDetails, LumaEvent } from '../_shared/types.ts';

async function buildIngestForCalendarEvent(event: LumaEvent): Promise<IngestEvent | null> {
    // Attribution flows from the event itself — the calendar that "presents"
    // it, not the account that discovered it. So an event found via
    // user/princejohn that's presented by GOAB attributes to GOAB, not to
    // princejohn. The calling account is just a discovery channel here.
    const presenter = event.presenter;
    if (!presenter) {
        console.warn(`[luma-cron] event ${event.api_id} has no presenter — skipping`);
        return null;
    }

    const account = await findOrCreateAccount({
        account_id: presenter.api_id,
        name: presenter.name,
        type: 'luma',
        kind: presenter.kind,
        primary_photo: presenter.avatar,
    });
    if (!account) {
        console.warn(`[luma-cron] event ${event.api_id} — could not persist presenter account`);
        return null;
    }

    return {
        name: event.name,
        description: event.description,
        start_time: event.start_time,
        end_time: event.end_time,
        location: event.location,
        location_details: event.location_details,
        cover_photo: event.cover_photo,
        source: 'luma',
        source_id: event.api_id,
        source_url: event.url,
        raw: event as unknown,
        organizers: [{ account_id: presenter.api_id, role: 'presenter' }],
    };
}

async function processCalendar(account: Account) {
    const { account_id, account_details } = account;

    const details = (account_details as LumaAccountDetails | null) ?? {};
    const path = details.path;

    if (!path) {
        console.warn(`[luma-cron] account ${account_id} has no "path" in account_details — skipping`);
        return null;
    }

    console.log(`[luma-cron] processing path "${path}" for account ${account_id}${details.label ? ` (${details.label})` : ''}`);

    const events = await fetchEventsForLumaPath(path);
    console.log(`[luma-cron] retrieved ${events.length} future event(s) from path ${path}`);

    const ingests: IngestEvent[] = [];
    for (const event of events) {
        const ingest = await buildIngestForCalendarEvent(event);
        if (ingest) ingests.push(ingest);
    }

    const results = await ingestEvents(ingests);
    console.log(
        `[luma-cron] ingested ${results.length} for ${account_id}: ` +
            `${results.filter((r) => r.is_new_event).length} new, ` +
            `${results.filter((r) => !r.is_new_event).length} matched/re-scraped, ` +
            `${results.filter((r) => r.became_canonical).length} became canonical`,
    );

    const eventRows = await getEventsByIds(results.map((r) => r.event_id));
    await storeCoverImages(eventRows);
    await geocodeEventLocations(eventRows);

    return results;
}

Deno.serve(async (req) => {
    try {
        const account: Account = await req.json();

        // @ts-ignore-next-line
        EdgeRuntime.waitUntil(processCalendar(account));

        return new Response(
            JSON.stringify({
                message: `Successfully queued processCalendar for account: ${account.account_id}`,
            }),
            {
                headers: { 'Content-Type': 'application/json' },
            },
        );
    } catch (error) {
        console.error('[luma-cron] error processing calendar:', error);
        return new Response(JSON.stringify({ error: 'Failed to process calendar' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
});
