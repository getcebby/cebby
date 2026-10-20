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
    const page = parseInt(url.searchParams.get('page') || '1');
    const per_page = Math.min(parseInt(url.searchParams.get('per_page') || '20'), 100);
    const upcomingParam = url.searchParams.get('upcoming');
    const upcoming = upcomingParam === '1' || upcomingParam === 'true';

    // Parse optional filter parameters
    const startAfterParam = url.searchParams.get('start_after');
    const startBeforeParam = url.searchParams.get('start_before');
    const isFreeParam = url.searchParams.get('is_free');
    const formatParam = url.searchParams.get('format');

    const filters: {
        start_after?: number;
        start_before?: number;
        is_free?: boolean;
        is_online?: boolean;
    } = {};

    if (startAfterParam) {
        filters.start_after = parseInt(startAfterParam, 10);
    }
    if (startBeforeParam) {
        filters.start_before = parseInt(startBeforeParam, 10);
    }
    if (isFreeParam !== null) {
        filters.is_free = isFreeParam === '1' || isFreeParam === 'true';
    }
    if (formatParam === 'online') {
        filters.is_online = true;
    } else if (formatParam === 'in-person') {
        filters.is_online = false;
    }

    // A blank query is only meaningful for the upcoming listing or when filters are present
    const hasFilters = Object.keys(filters).length > 0;
    if (!query.trim() && !upcoming && !hasFilters) {
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
            filters: Object.keys(filters).length > 0 ? filters : undefined,
        });

        // If Typesense returned an error field, return it as HTTP 200 with error
        if (searchResults.error) {
            return new Response(
                JSON.stringify({
                    results: [],
                    found: 0,
                    search_time_ms: 0,
                    error: searchResults.error,
                }),
                {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                },
            );
        }

        return new Response(
            JSON.stringify({
                ...searchResults,
                results: searchResults.results.map(withReadableTimes),
            }),
            {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
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
