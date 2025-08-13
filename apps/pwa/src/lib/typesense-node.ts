import Typesense from 'typesense';
import { 
    PUBLIC_TYPESENSE_HOST,
    PUBLIC_TYPESENSE_PORT,
    PUBLIC_TYPESENSE_PROTOCOL
} from 'astro:env/client';
import {
    TYPESENSE_HOST,
    TYPESENSE_PORT,
    TYPESENSE_PROTOCOL,
    TYPESENSE_ADMIN_KEY
} from 'astro:env/server';

const typesenseHost = TYPESENSE_HOST || PUBLIC_TYPESENSE_HOST || 'localhost';
const typesensePort = parseInt(TYPESENSE_PORT || PUBLIC_TYPESENSE_PORT || '8108');
const typesenseProtocol = TYPESENSE_PROTOCOL || PUBLIC_TYPESENSE_PROTOCOL || 'https';
const typesenseAdminKey = TYPESENSE_ADMIN_KEY || '';

console.log('🔧 Typesense Configuration:');
console.log(`  Host: ${typesenseHost}`);
console.log(`  Port: ${typesensePort}`);
console.log(`  Protocol: ${typesenseProtocol}`);
console.log(`  Admin Key: ${typesenseAdminKey ? '[SET]' : '[MISSING]'}`);

// Admin client for server-side operations (indexing, etc.)
export const typesenseAdminClient = new Typesense.Client({
    nodes: [
        {
            host: typesenseHost,
            port: typesensePort,
            protocol: typesenseProtocol as 'http' | 'https',
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
