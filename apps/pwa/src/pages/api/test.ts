import type { APIRoute } from 'astro';
import axios from 'axios';
import ical from 'ical';

interface ICalEvent {
    summary?: string;
    description?: string;
    start?: Date;
    end?: Date;
    location?: string;
    url?: string;
}

export const GET: APIRoute = async ({ request }) => {
    console.log('🚀 ~ constGET:APIRoute= ~ request:', request);

    const response = await axios.get('https://api.lu.ma/ics/get?entity=calendar&id=cal-Vp6gb1K89L8BFMR');

    // Parse the iCal data into JSON
    const events = ical.parseICS(response.data);

    // Transform the events into a more readable format
    const formattedEvents = Object.values(events).map(
        (event): ICalEvent => ({
            summary: event.summary,
            description: event.description,
            start: event.start,
            end: event.end,
            location: event.location,
            url: event.url,
        }),
    );

    console.log('🚀 ~ constGET:APIRoute= ~ parsed events:', formattedEvents);

    return new Response(JSON.stringify({ events: formattedEvents }), {
        status: 200,
        headers: {
            'Content-Type': 'application/json',
        },
    });
};
