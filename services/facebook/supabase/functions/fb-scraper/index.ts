import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { scrapeFbEvent, scrapeFbEventFromFbid, EventData } from 'facebook-event-scraper';
import {
    getEventBySourceId,
    getAccountByName,
    updateEventAccountId,
} from '@service/core/supabase/features/events/index.ts';

async function processEvent({ url, id }: { url: string; id: string }) {
    if (!url && !id) {
        throw new Error('URL and ID are required');
    }

    let event: EventData | null = null;

    try {
        event = id ? await scrapeFbEventFromFbid(id) : await scrapeFbEvent(url);
        console.log('🚀 ~ processEvent ~ event:', event);

        const { data: eventFromDB, error } = await getEventBySourceId(event.id);
        if (error) {
            throw new Error('Error fetching event from database');
        }

        // Update primary organizer of the event by picking the first host
        const primaryOrganizer = event.hosts?.[0];
        console.log('🚀 ~ processEvent ~ primaryOrganizer:', primaryOrganizer);
        if (!primaryOrganizer) {
            throw new Error('No primary organizer found! This should not happen!');
        }

        const { data: accountFromDB, error: accountError } = await getAccountByName(primaryOrganizer.name);
        console.log('🚀 ~ processEvent ~ accountFromDB:', accountFromDB);
        if (accountError) {
            throw new Error('Error fetching account from database');
        }

        if (accountFromDB) {
            // Update the primary organizer of the event
            await updateEventAccountId(eventFromDB.id, accountFromDB.account_id);
        }
    } catch (error) {
        console.error('🚀 ~ processEvent ~ error:', error);
    }

    return event;
}

Deno.serve(async (req) => {
    if (req.method !== 'POST') {
        return new Response('Method not allowed', { status: 405 });
    }

    const { url, id } = await req.json();
    console.log('🚀 ~ Deno.serve ~ url, id:', url, id);

    // @ts-ignore-next-line
    EdgeRuntime.waitUntil(processEvent({ url, id }));

    return new Response(JSON.stringify({ message: 'Event processed' }), {
        headers: { 'Content-Type': 'application/json' },
    });
});
