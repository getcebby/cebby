import Typesense from 'typesense';
import { 
    PUBLIC_TYPESENSE_HOST,
    PUBLIC_TYPESENSE_PORT,
    PUBLIC_TYPESENSE_PROTOCOL,
    PUBLIC_TYPESENSE_SEARCH_KEY
} from 'astro:env/client';

const typesenseHost = PUBLIC_TYPESENSE_HOST;
const typesensePort = parseInt(PUBLIC_TYPESENSE_PORT || '8108');
const typesenseProtocol = PUBLIC_TYPESENSE_PROTOCOL || 'https';
const typesenseSearchKey = PUBLIC_TYPESENSE_SEARCH_KEY || '';

// Typesense client configuration
export const typesenseClient = new Typesense.Client({
    nodes: [
        {
            host: typesenseHost,
            port: typesensePort,
            protocol: typesenseProtocol,
        },
    ],
    apiKey: typesenseSearchKey,
    connectionTimeoutSeconds: 10,
});

// Note: Admin client moved to typesense-node.ts for server-side use

// Event document interface for Typesense. The shape and the collection schema
// live with the indexers that write them (type-only import: nothing bundled).
export type { EventSearchDoc as EventDocument } from '@service/core/supabase/shared/search-doc.ts';
import type { EventSearchDoc as EventDocument } from '@service/core/supabase/shared/search-doc.ts';

// Search events function with optional filter support
export async function searchEvents(
    query: string,
    options: {
        per_page?: number;
        page?: number;
        // Only events that haven't started yet, soonest first
        upcoming?: boolean;
        // Optional Typesense filters (pushed to filter_by)
        filters?: {
            start_after?: number; // Unix timestamp (seconds)
            start_before?: number; // Unix timestamp (seconds)
            is_free?: boolean;
            is_online?: boolean;
            city?: string; // Normalized city, e.g. 'Cebu City'
        };
    } = {},
) {
    try {
        // Build filter_by clauses
        const filterClauses: string[] = [];
        
        if (options.upcoming) {
            filterClauses.push(`start_time:>=${Math.floor(Date.now() / 1000)}`);
        }
        
        if (options.filters) {
            if (options.filters.start_after !== undefined) {
                filterClauses.push(`start_time:>=${options.filters.start_after}`);
            }
            if (options.filters.start_before !== undefined) {
                filterClauses.push(`start_time:<=${options.filters.start_before}`);
            }
            if (options.filters.is_free !== undefined) {
                filterClauses.push(`is_free:=${options.filters.is_free}`);
            }
            if (options.filters.is_online !== undefined) {
                filterClauses.push(`is_online:=${options.filters.is_online}`);
            }
            if (options.filters.city) {
                // Backticks keep spaces and hyphens ('Lapu-Lapu') a single value
                filterClauses.push(`city:=\`${options.filters.city.replace(/`/g, '')}\``);
            }
        }
        
        const searchResults = await typesenseClient
            .collections<EventDocument>('events')
            .documents()
            .search({
                q: query,
                query_by: 'name,description,location,organization',
                sort_by: options.upcoming ? 'start_time:asc' : 'start_time:desc',
                per_page: options.per_page || 20,
                page: options.page || 1,
                ...(filterClauses.length > 0 ? { filter_by: filterClauses.join(' && ') } : {}),
            });

        return {
            results: searchResults.hits?.map((hit) => hit.document) || [],
            found: searchResults.found || 0,
            search_time_ms: searchResults.search_time_ms || 0,
        };
    } catch (error) {
        console.error('Typesense search error:', error);
        return {
            results: [],
            found: 0,
            search_time_ms: 0,
            error: error instanceof Error ? error.message : 'Search failed',
        };
    }
}

