export const prerender = false;

import type { APIRoute } from 'astro';
import type { Event } from '@service/core/supabase/shared/types';
import type { ICalEventData } from 'ical-generator';
import { addHours } from 'date-fns';
import icalendar from 'ical-generator';
import { supabase } from '../../lib/supabase';

export const GET: APIRoute = async ({ request }) => {
    const filename = `CebbyCalendar.ics`;

    // v2: include source_links so we can link the .ics entry to the canonical
    // source platform instead of guessing FB.
    const { data, error } = await supabase
        .from('events')
        .select('*,source_links:event_source_links!event_source_links_event_id_fkey(source,url)')
        .neq('status', 'hidden');

    if (error) {
        return new Response(JSON.stringify({ error: 'Unable to generate Cebby calendar!' }), {
            status: 500,
            headers: {
                'Content-Type': 'application/json',
            },
        });
    }

    // Remove duplicates based on event name
    const uniqueEvents = data?.reduce((unique: Event[], event) => {
        const exists = unique.find((e) => e.name?.toLowerCase() === event.name?.toLowerCase());
        if (!exists) {
            unique.push(event);
        }
        return unique;
    }, []);

    const events: ICalEventData[] = uniqueEvents?.map((event: Event) => {
        const startDate = event.start_time ? new Date(event.start_time) : new Date();
        const endDate = event.end_time ? new Date(event.end_time) : addHours(startDate, 4);

        return {
            start: startDate,
            end: endDate,
            summary: event.name || 'No name provided - Cebby Event',
            description: `${event.description || 'No provided description - Cebby Event'}\n\nView on Cebby: https://www.getcebby.com/events/${event.slug || event.id}`,
            url: (event as unknown as { source_links?: Array<{ url: string | null }> }).source_links?.[0]?.url
                ?? `https://www.getcebby.com/events/${event.slug || event.id}`,
        };
    });

    try {
        const calendar = icalendar({
            name: 'Events from Cebby',
            description: `Discover tech events happening in Cebu in one place`,
            prodId: `//cebby//calendar//EN`,
            events,
        });

        return new Response(calendar.toString(), {
            status: 200,
            headers: {
                'Content-Type': 'text/calendar; charset=utf-8',
                'Content-Disposition': `attachment; filename="${filename}"`,
            },
        });
    } catch (err) {
        console.error(err);
        return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
            status: 500,
            headers: {
                'Content-Type': 'application/json',
            },
        });
    }
};

// The OPTIONS handler is needed for CORS
export const OPTIONS: APIRoute = async ({ request }) => {
    return new Response(null, {
        status: 204,
        headers: {
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': '*',
        },
    });
};
