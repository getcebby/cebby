/**
 * Eventbrite account_details blob. discovery_path on accounts is the primary
 * seed; this JSON is optional label/metadata for admin UX.
 */
export interface EventbriteAccountDetails {
    /** Human label, e.g. "MCEXPERT" — optional; accounts.name is canonical. */
    label?: string;
    /** Organizer vanity slug if different from discovery_path. */
    path?: string;
    /** Eventbrite numeric organizer id when known. */
    organizer_id?: string;
}

/**
 * Normalized Eventbrite event after scrape. Filled by fetchEventbriteEvent
 * once implemented; scaffold only defines the contract.
 */
export interface EventbriteEvent {
    /** Stable Eventbrite event id (string — ids can exceed JS safe int). */
    eventbrite_id: string;
    url: string;
    name: string;
    description: string | null;
    start_time: string; // ISO
    end_time: string | null;
    timezone: string | null;
    location: string | null;
    location_details: { latitude: number; longitude: number } | null;
    cover_photo: string | null;
    is_free: boolean | null;
    organizer: EventbriteOrganizer;
    venue: EventbriteVenue | null;
    raw?: unknown;
}

export interface EventbriteOrganizer {
    /** Prefer numeric organizer id when available; else vanity slug. */
    account_id: string;
    name: string;
    /** Vanity / discovery path for calendar listing. */
    path: string;
    avatar: string | null;
}

export interface EventbriteVenue {
    name: string | null;
    address: string | null;
    city: string | null;
    region: string | null;
    country: string | null;
    lat: number | null;
    lng: number | null;
}
