import type { APIRoute } from 'astro';
import { supabase } from '../../lib/supabase';
import type { EventFromDB } from '../../types/database';

// Cebu events are Asia/Manila (+08:00, no DST)
const MANILA_OFFSET_SECONDS = 8 * 60 * 60;

function toManilaIso(isoString: string | null | undefined): string | null {
    if (!isoString) return null;
    // Parse the ISO timestamp and add Manila offset
    const date = new Date(isoString);
    const epochSeconds = Math.floor(date.getTime() / 1000);
    return new Date((epochSeconds + MANILA_OFFSET_SECONDS) * 1000)
        .toISOString()
        .replace('.000Z', '+08:00');
}

// Single event lookup endpoint for WebMCP get_event tool
// Respects the same visibility rules as the public site (published events only)
export const GET: APIRoute = async ({ request }) => {
    const url = new URL(request.url);
    const slugOrId = url.searchParams.get('slug') || url.searchParams.get('id');

    if (!slugOrId) {
        return new Response(
            JSON.stringify({ error: 'Missing slug or id parameter' }),
            {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            },
        );
    }

    try {
        // Common select with attribution data
        const EVENT_SELECT = `
            *,
            organizers:event_organizers(role,position,accounts(name)),
            source_links:event_source_links!event_source_links_event_id_fkey(id,source,url)
        `;

        let result;
        const isNumericId = /^\d+$/.test(slugOrId);

        if (isNumericId) {
            // Lookup by numeric ID
            result = await supabase
                .from('events')
                .select(EVENT_SELECT)
                .eq('id', parseInt(slugOrId, 10))
                .eq('status', 'published') // Only published events
                .single();
        } else {
            // Try lookup by slug first
            result = await supabase
                .from('events')
                .select(
                    `*,event_slugs!inner(),organizers:event_organizers(role,position,accounts(name)),source_links:event_source_links!event_source_links_event_id_fkey(id,source,url)`,
                )
                .eq('event_slugs.slug', slugOrId)
                .eq('status', 'published') // Only published events
                .single();

            // Fallback: try extracting ID from slug pattern (name--123)
            if (result.error && !result.data) {
                const eventId = slugOrId.split('--')[1];
                if (eventId && /^\d+$/.test(eventId)) {
                    result = await supabase
                        .from('events')
                        .select(EVENT_SELECT)
                        .eq('id', parseInt(eventId, 10))
                        .eq('status', 'published') // Only published events
                        .single();
                }
            }
        }

        if (result.error || !result.data) {
            return new Response(
                JSON.stringify({ error: 'Event not found or not published' }),
                {
                    status: 404,
                    headers: { 'Content-Type': 'application/json' },
                },
            );
        }

        const event = result.data as EventFromDB;

        // Format organizers
        const organizers = (event.organizers || [])
            .filter((o: any) => o?.accounts?.name)
            .map((o: any) => o.accounts.name);

        // Format source links
        const source_links = (event.source_links || []).map((s: any) => ({
            source: s.source,
            url: s.url,
        }));

        // Return event with canonical URL and Manila timezone timestamps
        return new Response(
            JSON.stringify({
                event: {
                    ...event,
                    start_time: toManilaIso(event.start_time),
                    end_time: toManilaIso(event.end_time),
                    canonical_url: `https://www.getcebby.com/events/${event.slug || event.id}`,
                    organizers,
                    source_links,
                },
            }),
            {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                    // Cache for 5 minutes
                    'Cache-Control': 'public, s-maxage=300, max-age=300, stale-while-revalidate=60',
                },
            },
        );
    } catch (error) {
        console.error('Error in event API:', error);
        return new Response(
            JSON.stringify({ error: 'Internal server error' }),
            {
                status: 500,
                headers: { 'Content-Type': 'application/json' },
            },
        );
    }
};

export const prerender = false;
