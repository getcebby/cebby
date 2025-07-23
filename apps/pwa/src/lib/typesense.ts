import Typesense from 'typesense';

const typesenseHost = import.meta.env.PUBLIC_TYPESENSE_HOST || 'typesense-cebby.dorellworks.com';
const typesensePort = parseInt(import.meta.env.PUBLIC_TYPESENSE_PORT || '8108');
const typesenseProtocol = import.meta.env.PUBLIC_TYPESENSE_PROTOCOL || 'https';
const typesenseSearchKey = import.meta.env.PUBLIC_TYPESENSE_SEARCH_KEY || '';
const typesenseAdminKey = import.meta.env.TYPESENSE_ADMIN_KEY || '';

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

// Admin client for server-side operations (indexing, etc.)
export const typesenseAdminClient = new Typesense.Client({
    nodes: [
        {
            host: typesenseHost,
            port: typesensePort,
            protocol: typesenseProtocol,
        },
    ],
    apiKey: typesenseAdminKey,
    connectionTimeoutSeconds: 10,
});

// Event document interface for Typesense
export interface EventDocument {
    id: string;
    name: string;
    description: string;
    start_time: number; // Unix timestamp for sorting
    end_time?: number;
    location: string;
    organization: string;
    is_free: boolean;
    is_online: boolean;
    tags: string[];
    slug: string | null;
    cover_photo: string | null;
}

// Collection schema for events
export const eventsCollectionSchema = {
    name: 'events',
    fields: [
        { name: 'name', type: 'string' },
        { name: 'description', type: 'string' },
        { name: 'start_time', type: 'int64' },
        { name: 'end_time', type: 'int64', optional: true },
        { name: 'location', type: 'string' },
        { name: 'organization', type: 'string' },
        { name: 'is_free', type: 'bool' },
        { name: 'is_online', type: 'bool' },
        { name: 'tags', type: 'string[]' },
        { name: 'slug', type: 'string', optional: true },
        { name: 'cover_photo', type: 'string', optional: true },
    ],
    default_sorting_field: 'start_time',
};

// Search events function
export async function searchEvents(
    query: string,
    options: {
        per_page?: number;
        page?: number;
    } = {},
) {
    try {
        const searchResults = await typesenseClient
            .collections('events')
            .documents()
            .search({
                q: query,
                query_by: 'name,description,location,organization',
                sort_by: 'start_time:desc',
                per_page: options.per_page || 20,
                page: options.page || 1,
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
