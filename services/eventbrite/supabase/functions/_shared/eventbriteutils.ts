import type { EventbriteEvent } from './types.ts';

/**
 * Parse a public Eventbrite event URL into a stable event id.
 * Supports eventbrite.com / .be / .co.uk / regional TLDs and /e/<slug>-<id>.
 */
export function parseEventbriteEventUrl(raw: string): { eventId: string; canonicalUrl: string } | null {
    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        return null;
    }
    const host = url.hostname.toLowerCase();
    if (!host.includes('eventbrite.')) return null;

    // /e/aicd-cebu-tickets-1993845961945  or  /e/1993845961945
    const m = url.pathname.match(/\/e\/(?:[^/]*-)?(\d+)\/?$/);
    if (!m) return null;
    const eventId = m[1]!;
    return {
        eventId,
        canonicalUrl: `https://${host}/e/${eventId}`,
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
