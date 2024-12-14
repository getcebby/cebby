import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { Account, EventUpdate } from '@service/core/supabase/shared/types.ts';
import { saveEvents } from '@service/core/supabase/features/events/index.ts';
import { retrieveEventsFromFacebook } from '../_shared/events.ts';
import { FacebookEvent } from '../_shared/types.ts';

Deno.serve(async (req) => {
    try {
        const account: Account = await req.json();
        const { account_id, access_token, page_access_token } = account;

        console.log(`Processing events for account: ${account_id}`);

        const pageId = account_id;
        const fields = 'id,name,cover,description,created_time,place,start_time,end_time';
        const url = `https://graph.facebook.com/v21.0/${pageId}/events?fields=${fields}&access_token=${
            page_access_token || access_token
        }&format=json&method=get`;

        const events = await retrieveEventsFromFacebook(url);
        console.log(`Retrieved ${events.length} events from Facebook for account: ${account_id}`);

        const mappedEvents = mapEventsToDB(events, account);
        console.log(`Mapped ${mappedEvents.length} events for account: ${account_id}`);

        const savedResult = await saveEvents(mappedEvents);
        console.log(`Saved events to DB for account: ${account_id}. Result:`, savedResult);

        return new Response(
            JSON.stringify({
                message: `Successfully processed ${events.length} events for account: ${account_id}`,
                events: events.length,
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
