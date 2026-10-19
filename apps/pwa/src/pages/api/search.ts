import type { APIRoute } from 'astro';
import { searchEvents, type EventDocument } from '../../lib/typesense';

// Cebu events are Asia/Manila (+08:00, no DST); expose readable timestamps
// alongside the raw epochs so API consumers don't have to do epoch math.
const MANILA_OFFSET_SECONDS = 8 * 60 * 60;

function toManilaIso(epochSeconds: number | undefined): string | null {
    if (typeof epochSeconds !== 'number') return null;
    return new Date((epochSeconds + MANILA_OFFSET_SECONDS) * 1000)
        .toISOString()
        .replace('.000Z', '+08:00');
}

function withReadableTimes(event: EventDocument) {
    return {
        ...event,
        start_time_iso: toManilaIso(event.start_time),
        end_time_iso: toManilaIso(event.end_time),
    };
}

export const GET: APIRoute = async ({ request }) => {
    const url = new URL(request.url);
    const query = url.searchParams.get('q') || '';
    
    // Parameter bounds: prevent abuse and excessive load
    const pageRaw = parseInt(url.searchParams.get('page') || '1');
    const page = Math.max(1, Math.min(pageRaw, 100)); // Max 100 pages
    
    const perPageRaw = parseInt(url.searchParams.get('per_page') || '20');
    const per_page = Math.max(1, Math.min(perPageRaw, 100)); // Max 100 results per page
    
    const upcomingParam = url.searchParams.get('upcoming');
    const upcoming = upcomingParam === '1' || upcomingParam === 'true';

    // A blank query is only meaningful for the upcoming listing, where it
    // means "everything from now on" (Typesense match-all).
    if (!query.trim() && !upcoming) {
        return new Response(
            JSON.stringify({
                results: [],
                found: 0,
                search_time_ms: 0,
            }),
            {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            },
        );
    }

    try {
        const searchResults = await searchEvents(query.trim() || '*', {
            page,
            per_page,
            upcoming,
        });

        return new Response(
            JSON.stringify({
                ...searchResults,
                results: searchResults.results.map(withReadableTimes),
            }),
            {
                status: 200,
                headers: { 
                    'Content-Type': 'application/json',
                    'Cache-Control': 'public, max-age=60, stale-while-revalidate=300'
                },
            },
        );
    } catch (error) {
        console.error('Search API error:', error);

        return new Response(
            JSON.stringify({
                results: [],
                found: 0,
                search_time_ms: 0,
                error: 'Search failed',
            }),
            {
                status: 500,
                headers: { 'Content-Type': 'application/json' },
            },
        );
    }
};
