export const prerender = false;

import type { APIRoute } from 'astro';
import { supabase } from '../../lib/supabase';
import { addHours } from 'date-fns';
import icalendar from 'ical-generator';
import type { ICalEventData } from 'ical-generator';
import type { Event } from '@service/core/supabase/shared/types';

export const GET: APIRoute = async ({ request }) => {
    const filename = `CebbyCalendar.ics`;

    const { data, error } = await supabase.from('events').select('*').filter('is_hidden', 'not.is', 'true');

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
            description: `${event.description || 'No provided description - Cebby Event'}\n\nView on Cebby: https://www.getcebby.com/events/${event.slug}`,
            url: `https://www.facebook.com/events/${event.source_id}`,
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
