/**
 * Server-only helper that fetches and groups events for the /events feed.
 * 
 * This replaces the former public /api/events-data endpoint. events.astro
 * now calls this helper directly during SSR instead of making a self-HTTP fetch.
 */

import { supabase } from './supabase';
import type { EventFromDB } from '../types/database';
import { getDateInTimezone } from '../utils/date';
import { groupEventsByPeriod } from '../utils/events';

export interface EventsFeedResponse {
    events: ReturnType<typeof groupEventsByPeriod>;
    allEvents: EventFromDB[];
    allUpcomingEvents: EventFromDB[];
    metrics: {
        upcomingCount: number;
        totalEvents: number;
    };
}

/**
 * Fetch events from the last 30 days onward, including nested organizers/
 * accounts/organizations and source_links, then group them by period.
 * 
 * Returns the same shape that /api/events-data.ts used to return.
 */
export async function getEventsFeed(): Promise<EventsFeedResponse | null> {
    try {
        const thirtyDaysAgo = getDateInTimezone(new Date());
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        // Fetch events from Supabase (last 30 days & upcoming). Includes the
        // multi-source attribution rows so cards/list/map render "Presented by …"
        // without an extra round-trip. FK-name disambiguation required because
        // events has multiple paths to both accounts and event_source_links
        // (PGRST201 otherwise).
        const { data: allEvents, error } = await supabase
            .from('events')
            .select('*,organizers:event_organizers(role,position,accounts(*,organizations(id,name,verified_at,accounts(account_id,name,is_verified,ingest_kind)))),source_links:event_source_links!event_source_links_event_id_fkey(id,source,source_id,url,ingest_kind,scraped_at)')
            .neq('status', 'hidden')
            .gte('start_time', thirtyDaysAgo.toISOString())
            .order('start_time', { ascending: false }) as {
            data: EventFromDB[] | null;
            error: any;
        };

        if (error) {
            console.error('Error fetching events:', error);
            return null;
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

        return {
            events,
            allEvents: allEvents ?? [],
            allUpcomingEvents,
            metrics: {
                upcomingCount: allUpcomingEvents.length,
                totalEvents: allEvents?.length || 0
            }
        };
    } catch (error) {
        console.error('Error in getEventsFeed:', error);
        return null;
    }
}
