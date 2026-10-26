import type { APIRoute } from 'astro';
import { buildDuplicateCandidates, groupSourceLinksByEvent, type DuplicateEventRow } from '../../../lib/duplicate-candidates';
import type { SourceLinkForContent } from '../../../lib/event-source-content';
import { supabase } from '../../../lib/supabase';

export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
    const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') ?? '25', 10) || 25, 1), 100);
    const threshold = Math.min(Math.max(Number(url.searchParams.get('threshold') ?? '0.72') || 0.72, 0.1), 1);

    const { data: events, error: eventErr } = (await supabase
        .from('events')
        .select('id, name, description, start_time, end_time, timezone, location, location_details, cover_photo, city, region, country, status, slug, primary_source_link_id')
        .neq('status', 'hidden')
        .order('start_time', { ascending: false })
        .limit(800)) as unknown as {
        data: DuplicateEventRow[] | null;
        error: { message: string } | null;
    };

    if (eventErr) {
        return new Response(JSON.stringify({ error: eventErr.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    const eventIds = (events ?? []).map((event) => event.id);
    let links: SourceLinkForContent[] = [];
    if (eventIds.length > 0) {
        const { data, error } = (await supabase
            .from('event_source_links')
            .select('id, event_id, source, source_id, url, ingest_kind, scraped_at, raw')
            .in('event_id', eventIds)) as unknown as {
            data: SourceLinkForContent[] | null;
            error: { message: string } | null;
        };
        if (error) {
            return new Response(JSON.stringify({ error: error.message }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' },
            });
        }
        links = data ?? [];
    }

    const linksByEvent = groupSourceLinksByEvent(links);
    const candidates = buildDuplicateCandidates(events ?? [], links, { limit, threshold }).map((candidate) => ({
        ...candidate,
        target_sources: linksByEvent.get(candidate.target.id) ?? [],
        duplicate_sources: linksByEvent.get(candidate.duplicate.id) ?? [],
    }));

    return new Response(JSON.stringify({ candidates, threshold }), {
        status: 200,
        headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache',
        },
    });
};
