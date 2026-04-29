/**
 * The singular "Presented by" entity for a Luma event — what Cebby attributes
 * the event to in its UI. Comes from `data.calendar` when the event belongs to
 * a calendar (the common case); falls back to the first user host when the
 * event has no calendar (solo-organized events).
 */
export interface LumaPresenter {
    /** Luma's stable api_id (e.g. "cal-58Fivtd4JcBjF6A" or "usr-..."). */
    api_id: string;
    name: string;
    /** Whether the presenter is a community calendar or a solo individual. */
    kind: 'luma_calendar' | 'luma_user';
    avatar: string | null;
}

/**
 * Normalized internal shape for a Luma event after __NEXT_DATA__ extraction.
 * Carries the rich fields Luma already gives us (coords, location_type, api_id,
 * presenter) so we don't have to recompute them downstream.
 */
export interface LumaEvent {
    /** Luma's stable api_id (e.g. "evt-DGc0j5LmlqV1z"). Used as source_id in DB. */
    api_id: string;
    /** Luma slug — the path part of luma.com/{slug}. May change if host renames. */
    slug: string;
    /** Canonical https://luma.com/{slug}. */
    url: string;
    name: string;
    description: string | null;
    /** ISO 8601, with offset preserved as Luma emits it. */
    start_time: string;
    /** ISO 8601 or null when the event has no end time. */
    end_time: string | null;
    /** Named timezone Luma emits (e.g. 'Asia/Manila'). Useful alongside start_time
     * because the offset alone doesn't tell you whether DST is involved. */
    timezone: string | null;
    cover_photo: string | null;
    /** Display address line — venue name + city, or "Online (Zoom)" for virtual. */
    location: string | null;
    /** "offline" | "zoom" | "online" | other — Luma's own classification. */
    location_type: string | null;
    /** Coordinates from Luma's geo_address_info, when present. */
    location_details: { latitude: number; longitude: number } | null;
    /** Geographic anchors. For physical events, from event.geo_address_info.
     * For online events, falls back to the calendar's city — so an online
     * event presented by a Cebu-anchored calendar still tags as 'Cebu City'. */
    city: string | null;
    region: string | null;
    country: string | null;
    /**
     * The "Presented by" attribution — singular per Luma's UI. May be null when
     * neither calendar nor host could be determined (rare; ingestion skips
     * these events since they have no organizer to attribute to).
     */
    presenter: LumaPresenter | null;
    /**
     * Individual hosts as Luma reports them ("Hosted by" list) — metadata only,
     * NOT used for organizational attribution. Cebby surfaces these via the
     * deep-link to Luma rather than mirroring them as organizers.
     */
    hosts: Array<{ api_id: string; name: string; avatar: string | null }>;
}

/** Subset of the account_details JSON we expect on Luma-type accounts. */
export interface LumaAccountDetails {
    /**
     * Luma path identifier — either a calendar slug ("goab", "awsugcebu")
     * or a user handle path ("user/lisksea").
     */
    path?: string;
    /** Optional human label, used in logs. */
    label?: string;
}
