/**
 * Shape of a single Meetup event after parsing the Apollo state on the
 * detail page (`https://www.meetup.com/<urlname>/events/<id>/`). This is the
 * stable form the cron and manual scraper both produce; the ingest layer
 * maps it into the v2 IngestEvent shape.
 */
export interface MeetupEvent {
    /** Meetup's numeric event id (string-typed because it routinely overflows JS int safety). */
    meetup_id: string;
    /** Canonical event URL on meetup.com. */
    url: string;
    name: string;
    description: string | null;
    start_time: string; // ISO
    end_time: string | null; // ISO
    timezone: string | null; // best-effort; Meetup serves dateTime with offset

    /** Free-text location string for the events table. */
    location: string | null;
    /** { latitude, longitude } when the venue carries coords. */
    location_details: { latitude: number; longitude: number } | null;

    /** Cover photo URL on Meetup's CDN. storeCoverImages re-hosts to R2. */
    cover_photo: string | null;

    /** Organizing community for "Presented by" attribution. */
    group: MeetupGroup;

    /** Diagnostic / metadata. */
    going_count?: number | null;
    max_tickets?: number | null;
    venue?: MeetupVenue | null;
}

export interface MeetupGroup {
    /** URL slug, e.g. `pizzapy-ph`. */
    urlname: string;
    /** Display name, e.g. `PizzaPy PH`. */
    name: string;
    /** Group avatar URL (Meetup CDN). May be null on freshly-created groups. */
    avatar: string | null;
    /** City field on the group entity — used as fallback for venue.city. */
    city: string | null;
}

export interface MeetupVenue {
    name: string | null;
    address: string | null;
    city: string | null;
    lat: number | null;
    lng: number | null;
}

/**
 * Subset of fields the cron orchestrator passes through. Mirrors the shape
 * `fan_out_account_syncs('meetup', …)` POSTs to the per-account function:
 * a full row from public.accounts.
 */
export interface MeetupAccountDetails {
    /** Optional human-friendly label kept on account_details for log context. */
    label?: string;
}
