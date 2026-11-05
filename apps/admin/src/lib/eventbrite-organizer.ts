import { isEventbriteHost } from './eventbrite-url';

/**
 * What the operator typed into "Watch an Eventbrite organizer": an organizer
 * (its page link or bare id) or an event link, whose organizer gets watched.
 */
export type OrganizerInput =
    | { kind: 'organizer'; organizerId: string; path: string | null }
    | { kind: 'event'; eventId: string }
    | { error: string };

const ORGANIZER_PATH = /^\/o\/((?:[a-z0-9-]+-)?(\d{6,}))\/?$/i;
const EVENT_PATH = /^\/e\/(?:[a-z0-9-]+-)?(\d{6,})\/?$/i;

export function parseEventbriteOrganizerInput(raw: string): OrganizerInput {
    const input = raw.trim();
    if (!input) return { error: 'Paste an Eventbrite organizer link, an organizer id, or one of its event links.' };
    if (/^\d{6,}$/.test(input)) return { kind: 'organizer', organizerId: input, path: null };

    let url: URL;
    try {
        url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
    } catch {
        return { error: `"${input}" isn't a link or an organizer id.` };
    }
    if (!isEventbriteHost(url.hostname)) return { error: `${url.hostname} isn't Eventbrite.` };

    const organizer = url.pathname.match(ORGANIZER_PATH);
    if (organizer) return { kind: 'organizer', organizerId: organizer[2], path: organizer[1] };
    const event = url.pathname.match(EVENT_PATH);
    if (event) return { kind: 'event', eventId: event[1] };
    return { error: 'Expected an organizer page (eventbrite.com/o/…) or an event page (eventbrite.com/e/…).' };
}

// Eventbrite's keyless JSON endpoints answer browsers; send what a browser sends.
const HEADERS = {
    'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    'Accept': 'application/json',
};

async function getJson(url: string, fetchFn: typeof fetch): Promise<{ status: number; body: Record<string, unknown> | null }> {
    const res = await fetchFn(url, { headers: HEADERS });
    const body = res.ok ? await res.json().catch(() => null) as Record<string, unknown> | null : null;
    return { status: res.status, body };
}

/** The organizer the input points at, checked against Eventbrite: its id, name and page path. */
export async function resolveEventbriteOrganizer(
    input: OrganizerInput,
    fetchFn: typeof fetch = fetch,
): Promise<{ organizerId: string; name: string; path: string | null } | { error: string }> {
    if ('error' in input) return input;

    let organizerId: string;
    if (input.kind === 'event') {
        const event = await getJson(`https://www.eventbrite.com/api/v3/events/${input.eventId}/`, fetchFn);
        const id = event.body?.organizer_id;
        if (typeof id !== 'string' && typeof id !== 'number') {
            return { error: `Couldn't look up Eventbrite event ${input.eventId} (HTTP ${event.status}).` };
        }
        organizerId = String(id);
    } else {
        organizerId = input.organizerId;
    }

    const organizer = await getJson(`https://www.eventbrite.com/api/v3/organizers/${organizerId}/`, fetchFn);
    if (organizer.status === 404) return { error: `No Eventbrite organizer with id ${organizerId}.` };
    if (!organizer.body) return { error: `Couldn't look up Eventbrite organizer ${organizerId} (HTTP ${organizer.status}).` };

    const name = typeof organizer.body.name === 'string' && organizer.body.name.trim()
        ? organizer.body.name.trim()
        : `Eventbrite organizer ${organizerId}`;
    const pageUrl = typeof organizer.body.url === 'string' ? organizer.body.url : '';
    const path = pageUrl.match(/\/o\/([^/?#]+)/)?.[1] ?? (input.kind === 'organizer' ? input.path : null);
    return { organizerId, name, path };
}
