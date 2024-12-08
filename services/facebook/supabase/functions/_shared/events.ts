import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { FacebookEvent } from './types.ts';

export async function retrieveEventsFromFacebook(url: string): Promise<FacebookEvent[]> {
    const allEvents = [];

    try {
        const response = await fetch(url, {
            method: 'GET',
        });
        const result = await response.json();
        allEvents.push(...result.data);

        if (result?.paging?.next) {
            const nextEvents = await retrieveEventsFromFacebook(result.paging.next);
            allEvents.push(...nextEvents);
        }
    } catch (error) {
        if (error instanceof Response) {
            // The request was made and the server responded with a status code
            // that falls out of the range of 2xx
            console.log(await error.json());
            console.log(error.status);
            console.log(error.headers);
        } else if (error instanceof Error) {
            // Something happened in setting up the request that triggered an Error
            console.log('Error', error.message);
        } else {
            console.log('Unknown error', error);
        }
    }

    return allEvents;
}
