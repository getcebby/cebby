import type { APIRoute } from 'astro';
import { supabase } from '../../lib/supabase';

export const GET: APIRoute = async ({ request }) => {
    const url = new URL(request.url);
    const query = url.searchParams.get('q');

    if (!query) {
        return new Response(JSON.stringify([]), {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
            },
        });
    }

    try {
        const { data: events, error } = await supabase
            .from('events')
            .select('*')
            .or(`name.ilike.%${query}%, description.ilike.%${query}%`)
            .order('start_time', { ascending: false })
            .limit(5);

        if (error) throw error;

        return new Response(JSON.stringify(events), {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
            },
        });
    } catch (error) {
        console.error('Search error:', error);
        return new Response(JSON.stringify({ error: 'Search failed' }), {
            status: 500,
            headers: {
                'Content-Type': 'application/json',
            },
        });
    }
};
