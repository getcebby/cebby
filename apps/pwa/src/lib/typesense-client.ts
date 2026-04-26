// Browser-safe Typesense client — uses fetch against the HTTP API directly,
// avoiding the Node SDK (which references `global` and breaks in the browser).
import {
    PUBLIC_TYPESENSE_HOST,
    PUBLIC_TYPESENSE_PORT,
    PUBLIC_TYPESENSE_PROTOCOL,
    PUBLIC_TYPESENSE_SEARCH_KEY,
} from 'astro:env/client';

import type { EventDocument } from './typesense';
export type { EventDocument };

const host = PUBLIC_TYPESENSE_HOST;
const port = PUBLIC_TYPESENSE_PORT || '8108';
const protocol = PUBLIC_TYPESENSE_PROTOCOL || 'https';
const searchKey = PUBLIC_TYPESENSE_SEARCH_KEY || '';

export async function searchEventsClient(
    query: string,
    options: { per_page?: number; page?: number } = {},
): Promise<{
    results: EventDocument[];
    found: number;
    search_time_ms: number;
    error?: string;
}> {
    const params = new URLSearchParams({
        q: query,
        query_by: 'name,description,location,organization',
        sort_by: 'start_time:desc',
        per_page: String(options.per_page ?? 20),
        page: String(options.page ?? 1),
    });
    const url = `${protocol}://${host}:${port}/collections/events/documents/search?${params.toString()}`;

    try {
        const res = await fetch(url, {
            headers: { 'X-TYPESENSE-API-KEY': searchKey },
        });
        if (!res.ok) {
            return { results: [], found: 0, search_time_ms: 0, error: `HTTP ${res.status}` };
        }
        const data = await res.json();
        return {
            results: (data.hits ?? []).map((h: { document: EventDocument }) => h.document),
            found: data.found ?? 0,
            search_time_ms: data.search_time_ms ?? 0,
        };
    } catch (error) {
        return {
            results: [],
            found: 0,
            search_time_ms: 0,
            error: error instanceof Error ? error.message : 'Search failed',
        };
    }
}
