import type { EventbriteEvent } from './types.ts';

// eventbrite.com and its country sites. Matched exactly so lookalike hosts such
// as eventbrite.attacker.example are rejected. Mirrored in
// apps/admin/src/lib/eventbrite-url.ts.
const EVENTBRITE_HOST =
    /^(?:www\.)?eventbrite\.(?:com|ca|ie|de|fr|es|it|nl|be|at|ch|pt|se|dk|fi|sg|hk|co|cl|co\.uk|co\.nz|com\.au|com\.br|com\.mx|com\.ar|com\.pe)$/;

/**
 * Parse a public Eventbrite event URL into a stable event id.
 * Supports eventbrite.com and its country sites, with /e/<slug>-<id> or /e/<id>.
 * The canonical URL always uses www.eventbrite.com, which redirects to the
 * event's regional page, so the scraper never fetches a user-supplied host.
 */
export function parseEventbriteEventUrl(raw: string): { eventId: string; canonicalUrl: string } | null {
    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        return null;
    }
    if (!EVENTBRITE_HOST.test(url.hostname.toLowerCase())) return null;

    // /e/aicd-cebu-tickets-1993845961945  or  /e/1993845961945
    const m = url.pathname.match(/\/e\/(?:[^/]*-)?(\d+)\/?$/);
    if (!m) return null;
    const eventId = m[1]!;
    return {
        eventId,
        canonicalUrl: `https://www.eventbrite.com/e/${eventId}`,
    };
}

/**
 * TODO: Fetch + parse a single Eventbrite event page.
 * Candidates: schema.org Event JSON-LD, window.__SERVER_DATA__, public API.
 */
export async function fetchEventbriteEvent(_url: string): Promise<EventbriteEvent | null> {
    throw new Error(
        'Eventbrite scraper not implemented yet — see services/eventbrite/README.md TODOs',
    );
}

/**
 * TODO: List upcoming events for an organizer discovery_path / vanity slug.
 */
export async function fetchEventsForEventbriteOrganizer(
    _discoveryPath: string,
): Promise<EventbriteEvent[]> {
    throw new Error(
        'Eventbrite organizer listing not implemented yet — see services/eventbrite/README.md TODOs',
    );
}
