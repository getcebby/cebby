import type { APIRoute } from 'astro';
import { supabase } from '../../lib/supabase';

interface Event {
    id: string;
    slug: string;
    name: string;
    description: string;
    start_time: string;
    location: string;
    image_url: string;
    event_type: string;
}

interface SearchResult {
    slug: string;
    title: string;
    date: string;
    location: string;
    image: string;
    category: string;
}

export const GET: APIRoute = async ({ url }) => {
    const query = url.searchParams.get('q');

    if (!query) {
        return new Response(JSON.stringify({ error: 'Search query is required' }), { status: 400 });
    }

    try {
        const { data: events, error } = (await supabase
            .from('events')
            .select('*')
            .textSearch('name', query)
            .or(`description.ilike.%${query}%,location.ilike.%${query}%`)
            .order('start_time', { ascending: true })
            .limit(10)) as { data: Event[] | null; error: Error | null };

        if (error) throw error;
        if (!events) return new Response(JSON.stringify([]), { status: 200 });

        const searchResults: SearchResult[] = events.map((event) => ({
            slug: event.slug,
            title: event.name,
            date: new Date(event.start_time).toLocaleDateString('en-US', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric',
            }),
            location: event.location,
            image: event.image_url,
            category: event.event_type,
        }));

        return new Response(JSON.stringify(searchResults), {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
            },
        });
    } catch (error) {
        console.error('Search error:', error);
        return new Response(JSON.stringify({ error: 'Failed to perform search' }), { status: 500 });
    }
};
