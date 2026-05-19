export interface EventFromDB {
    id: string;
    name: string;
    description: string;
    start_time: string;
    end_time: string | null;
    location: string;
    /**
     * Geocoded coordinates for `location`. Populated by the backfill script
     * (`pnpm backfill-coords`) and incrementally as new events are ingested.
     * `null` when not yet geocoded; map view falls back to the venue registry
     * for known canonical venues, or hides the event from the map otherwise.
     */
    location_details: { latitude: number; longitude: number } | null;
    cover_photo: string | null;
    created_at: string;
    updated_at: string;
    slug: string | null;

    accounts: AccountsFromDB | null;

    is_free: boolean;
    price?: number | null;
    is_online: boolean;
    status: 'draft' | 'published' | 'hidden' | 'cancelled' | 'scheduled' | 'postponed' | string | null;
    is_featured?: boolean;
    registration_enabled?: boolean | null;
    registration_deadline?: string | null;
    registration_limit?: number | null;

    account_id?: string;

    source: string; // facebook | manual | website
    source_id: string;

    tags?: EventTag[];
    type?: 'default' | 'workshop' | 'conference' | 'meetup';

    // The direct link to RSVP on the event
    ticket_url?: string;

    // ── Multi-source attribution model (post-20260428130000 migration) ───────
    // These fields are populated when queries include the corresponding nested
    // selects (`organizers:event_organizers(...)`, `source_links:event_source_links(*)`).
    // They're optional so existing simple `select('*')` queries still type-check.
    organizers?: EventOrganizerRow[];
    source_links?: EventSourceLinkRow[];
    primary_source_link_id?: number | null;
}

/** One row from event_organizers joined to its account. */
export interface EventOrganizerRow {
    role: string;
    position: number;
    accounts: AccountsFromDB | null;
}

/** One row from event_source_links — a single platform-presence of an event. */
export interface EventSourceLinkRow {
    id: number;
    source: string;
    source_id: string;
    url: string | null;
    ingest_kind?: 'manual' | 'partnership' | 'public_api' | 'public_scrape' | string | null;
    scraped_at: string;
    created_at?: string;
    updated_at?: string;
}

export interface AccountsFromDB {
    created_at: string | number | Date;
    id: string;
    name: string;
    account_id: string | number;
    primary_photo: string;
    url?: string;
    is_verified?: boolean | null;
    ingest_kind?: 'manual' | 'partnership' | 'public_api' | 'public_scrape' | string | null;
    organization_id?: number | null;
    organizations?: AccountOrganizationFromDB | null;
}

export interface AccountTrustPeer {
    account_id: string | number;
    name: string;
    is_verified?: boolean | null;
    ingest_kind?: 'manual' | 'partnership' | 'public_api' | 'public_scrape' | string | null;
}

export interface AccountOrganizationFromDB {
    id: number;
    name: string;
    slug?: string | null;
    verified_at?: string | null;
    accounts?: AccountTrustPeer[];
}

export interface Profile {
    id: string;
    logto_user_id: string;
    name?: string;
    email: string;
    avatar_url?: string;
    bio?: string;
    contact_details?: Record<string, any>;
    social_links?: Record<string, any>;
    metadata?: Record<string, any>;
    created_at: string;
    updated_at: string;
    deleted_at?: string;
}

export interface EventRSVP {
    id: string;
    event_id: string;
    profile_id?: string;
    email: string;
    name: string;
    phone?: string;
    status: 'pending' | 'confirmed' | 'cancelled' | 'declined' | 'waitlisted' | 'walkin';
    type: 'online' | 'walk_in';
    registered_at: string;
    confirmed_at?: string;
    cancelled_at?: string;
    checked_in_at?: string;
    check_in_method?: 'qr_code' | 'manual' | 'nfc';
    qr_code_id?: string;
    verification_token?: string;
    metadata?: Record<string, any>;
    created_at: string;
    updated_at: string;
}

export type SearchParams = {
    query?: string;
    filter?: string;
    page?: number;
    limit?: number;
};

export interface AccountsFromDB {
    id: string;
    name: string;
    account_id: string | number;
    page_access_token?: string;
    is_active?: boolean;
    is_verified?: boolean | null;
    ingest_kind?: 'manual' | 'partnership' | 'public_api' | 'public_scrape' | string | null;
    organization_id?: number | null;
}

export interface EventCategory {
    id: string;
    name: string;
    event_count: number;
    slug: string;
    description?: string;
    icon?: string;
}

export interface EventOrganizer {
    id: string;
    name: string;
    logo?: string;
    description?: string;
    website?: string;
    is_verified: boolean;
    event_count: number;
    social_links?: {
        twitter?: string;
        facebook?: string;
        linkedin?: string;
    };
}

export interface LocationCount {
    location: string;
    count: number;
}

export interface EventTag {
    id: string;
    name: string;
    color: string;
}
