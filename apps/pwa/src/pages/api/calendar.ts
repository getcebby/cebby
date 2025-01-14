import type { APIRoute } from 'astro';
import { supabase } from '../../lib/supabase';
import { addHours } from 'date-fns';
import icalendar from 'ical-generator';
import type { ICalEventData } from 'ical-generator';
import type { Event } from '@service/core/supabase/shared/types';

const TIMEZONE = 'Asia/Manila';
function getDateInTimezone(date: Date): Date {
    return new Date(date.toLocaleString('en-US', { timeZone: TIMEZONE }));
}

export const GET: APIRoute = async ({ request }) => {
    const filename = `CebbyCalendar.ics`;

    const { data, error } = await supabase.from('events').select('*');

    if (error) {
        return new Response(JSON.stringify({ error: 'Unable to generate calendar!' }), {
            status: 500,
            headers: {
                'Content-Type': 'application/json',
            },
        });
    }

    const events: ICalEventData[] = data?.map((event: Event) => {
        const startDate = event.start_time ? getDateInTimezone(new Date(event.start_time)) : new Date();
        const endDate = event.end_time ? getDateInTimezone(new Date(event.end_time)) : addHours(startDate, 4);

        return {
            start: startDate,
            end: endDate,
            summary: event.name || 'No Title',
            description: event.description || 'No Description',
            url: `https://www.facebook.com/events/${event.source_id}`,
        };
    });
    console.log('🚀 ~ constevents:ICalEventData[]=data?.map ~ events:', events);

    try {
        const calendar = icalendar({
            name: 'Events from Cebby',
            description: `Discover tech events happening in Cebu in one place`,
            prodId: `//cebby//calendar//EN`,
            events,
        });

        // return new Response(JSON.stringify({ events }), {
        //     status: 200,
        //     headers: {
        //         'Content-Type': 'application/json',
        //     },
        // });

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
