import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { Account, EventUpdate } from '@service/core/supabase/shared/types.ts';
import { saveEvents, storeCoverImages } from '@service/core/supabase/features/events/index.ts';
import { retrieveEventsFromFacebook } from '../_shared/events.ts';
import { FacebookEvent } from '../_shared/types.ts';

// organizers are just one here, they should be many
// main organizer should be primary one
// image should be stored in Supabase and reference as such
// convert to supabase queue

// 1. for each account, queue the account
// for each account, process the events, do we need to chunk?

async function processEvents(account: Account) {
    const { account_id, access_token, page_access_token } = account;

    console.log(`Processing events for account: ${account_id}`);

    const pageId = account_id;
    const fields = 'id,name,cover,description,created_time,place,start_time,end_time';
    const url = `https://graph.facebook.com/v21.0/${pageId}/events?fields=${fields}&access_token=${
        page_access_token || access_token
    }&format=json&method=get`;

    const events = await retrieveEventsFromFacebook(url);
    console.log(`Retrieved ${events.length} events from Facebook for account: ${account_id}`);

    // trim to 2
    // events.length = 1;

    const mappedEvents = mapEventsToDB(events, account);
    console.log(`[INFO] Mapped ${mappedEvents.length} events for account: ${account_id}`);
    const savedResult = await saveEvents(mappedEvents);

    // This is a fire and forget operation
    await storeCoverImages(savedResult.data);

    // Supplement data in Supabase
    // @todo: We use FB scraping per URL to make sure we supplement other information

    return savedResult;
}

Deno.serve(async (req) => {
    try {
        const account: Account = await req.json();

        // @ts-ignore-next-line
        EdgeRuntime.waitUntil(processEvents(account));

        return new Response(
            JSON.stringify({
                message: `Successfully run processEvents for account: ${account.account_id}`,
            }),
            {
                headers: { 'Content-Type': 'application/json' },
            },
        );
    } catch (error) {
        console.error('Error processing events:', error);
        return new Response(JSON.stringify({ error: 'Failed to process events' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
});

function mapEventsToDB(events: FacebookEvent[], account: Account): EventUpdate[] {
    return events.map((event) => ({
        name: event.name,
        description: event.description,
        start_time: event.start_time,
        end_time: event.end_time,
        location: event.place?.name,
        cover_photo: event.cover?.source,
        source: account.type || 'facebook',
        source_id: event.id,
        account_id: account.account_id,
    }));
}
