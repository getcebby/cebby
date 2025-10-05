import type { APIRoute } from 'astro';
import { supabase } from '../../lib/supabase';
import type { EventFromDB } from '../../types/database';
import { getDateInTimezone } from '../../utils/date';
import { groupEventsByPeriod } from '../../utils/events';

export const GET: APIRoute = async ({ request }) => {
    try {
        // Get cache control from query params (default 5 minutes)
        const url = new URL(request.url);
        const cacheMinutes = parseInt(url.searchParams.get('cache') || '5');

        // Current date calculations for Supabase query
        const thirtyDaysAgo = getDateInTimezone(new Date());
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        // Fetch events from Supabase (last 30 days & upcoming)
        const { data: allEvents, error } = await supabase
            .from('events')
            .select('*')
            .or('is_hidden.is.null,is_hidden.eq.false')
            .gte('start_time', thirtyDaysAgo.toISOString())
            .order('start_time', { ascending: false }) as {
            data: EventFromDB[] | null;
            error: any;
        };

        if (error) {
            console.error('Error fetching events:', error);
            return new Response(JSON.stringify({ error: 'Failed to fetch events' }), {
                status: 500,
                headers: {
                    'Content-Type': 'application/json',
                    'Cache-Control': 'no-cache'
                }
            });
        }

        // Group, dedupe and sort
        const events = groupEventsByPeriod(allEvents ?? []);

        // Get all upcoming events for meta info
        const allUpcomingEvents = [
            ...(events?.today || []),
            ...(events?.tomorrow || []),
            ...(events?.thisWeek || []),
            ...(events?.thisMonth || []),
            ...(events?.nextMonth || []),
            ...(events?.later || []),
        ];

        const response = {
            events,
            allEvents,
            allUpcomingEvents,
            metrics: {
                upcomingCount: allUpcomingEvents.length,
                totalEvents: allEvents?.length || 0
            }
        };

        return new Response(JSON.stringify(response), {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                // Cache for specified minutes on edge and browser
                'Cache-Control': `public, s-maxage=${cacheMinutes * 60}, max-age=${cacheMinutes * 60}, stale-while-revalidate=60`,
                // Add CDN cache tag for targeted purging
                'CDN-Cache-Control': `max-age=${cacheMinutes * 60}`,
                // Add surrogate key for cache invalidation
                'Surrogate-Key': 'events-data'
            }
        });
    } catch (error) {
        console.error('Error in events-data API:', error);
        return new Response(JSON.stringify({ error: 'Internal server error' }), {
            status: 500,
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache'
            }
        });
    }
};

// Prerender this endpoint to generate static JSON
export const prerender = false;