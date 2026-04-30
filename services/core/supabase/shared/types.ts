import type { Tables, TablesInsert, TablesUpdate } from './database.types.ts';

export type Account = Tables<'accounts'>;
export type AccountInsert = TablesInsert<'accounts'>;
export type AccountUpdate = TablesUpdate<'accounts'>;

export type Event = Tables<'events'>;
export type EventInsert = TablesInsert<'events'>;
export type EventUpdate = TablesUpdate<'events'>;

export type EventSlug = Tables<'event_slugs'>;
export type EventSlugInsert = TablesInsert<'event_slugs'>;
export type EventSlugUpdate = TablesUpdate<'event_slugs'>;

// New tables from the multi-org / source-links migration. The auto-generated
// database.types.ts file is currently empty (`[_ in never]: never`), so until
// it's regenerated post-migration these are hand-typed shapes.

export interface Organization {
    id: number;
    name: string;
    slug: string | null;
    source_priority: string[] | null;
    primary_photo: string | null;
    website: string | null;
    is_individual: boolean;
    is_active: boolean;
    created_at: string;
    updated_at: string;
}

export interface EventSourceLink {
    id: number;
    event_id: number;
    source: string;
    source_id: string;
    url: string | null;
    scraped_at: string;
    raw: unknown;
    created_at: string;
}

export interface EventOrganizer {
    event_id: number;
    account_id: string;
    role: string;
    position: number;
    created_at: string;
}

export interface QueueMessage<T> {
    msg_id: string;
    read_ct: number;
    enqueued_at: string;
    vt: string;
    message: T;
}

// --- Ingest pipeline shapes ----------------------------------------------------

/**
 * The shape scrapers hand to ingestEvents(). Carries everything needed to
 * either create a new event or attach a new source-link to an existing event.
 */
export interface IngestEvent {
    name: string;
    description: string | null;
    start_time: string;
    end_time: string | null;
    location: string | null;
    location_details: { latitude: number; longitude: number } | null;
    cover_photo: string | null;

    /** Named timezone (e.g. 'Asia/Manila'). Optional but recommended — start_time
     * preserves the offset, but the named zone is what UIs need for "8 PM PHT". */
    timezone?: string | null;

    /** in_person | online | hybrid. Derived per-platform; populated when
     * known so the PWA filter chips don't have to text-match "Online" prefixes. */
    format?: 'in_person' | 'online' | 'hybrid' | null;

    /** Denormalized geographic fields. For physical events, comes from the
     * venue/place data. For online events from a Cebu-anchored community,
     * comes from the organizing calendar/page (so "events from Cebu" filter
     * still includes their online events). */
    city?: string | null;
    region?: string | null;
    country?: string | null;

    /** Source platform — 'facebook' | 'luma' | 'meetup' | etc. */
    source: string;
    /** Platform-specific event ID. */
    source_id: string;
    /** Canonical URL on the source platform. */
    source_url: string;
    /** Optional full scraped payload (stored on event_source_links.raw). */
    raw?: unknown;

    /** Reliability tier of this scrape. Drives canonical-content priority and
     * surfaces in the verified-data badge. 'partnership' for tokenized FB or
     * future Luma API access; 'public_scrape' for HTML/__NEXT_DATA__ extraction. */
    ingest_kind?: 'manual' | 'partnership' | 'public_api' | 'public_scrape' | null;

    /**
     * Accounts that organize this event. Order matters — position 0 is the
     * primary host. Each account_id must already exist in the accounts table
     * (caller's responsibility — see findOrCreateAccount).
     */
    organizers: Array<{ account_id: string; role?: string }>;

    /**
     * How organizer rows should be persisted. Use `replace` when the source
     * gives the complete "Presented by" list; use `merge` only for partial
     * fallbacks that should not delete known co-presenters.
     */
    organizer_write_mode?: 'replace' | 'merge';
}

export interface IngestResult {
    /** ID of the events row this ingest attached to (new or existing). */
    event_id: number;
    /** True if a new events row was created; false if matched an existing one. */
    is_new_event: boolean;
    /** ID of the source-link row created or refreshed during this ingest. */
    source_link_id: number;
    /** Whether this scrape's content became canonical (overwrote events row). */
    became_canonical: boolean;
    /** Score from the matcher when matched (null when is_new_event=true). */
    match_score: number | null;
}
