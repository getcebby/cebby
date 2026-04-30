import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { MeetupEvent, MeetupGroup, MeetupVenue } from './types.ts';

const MEETUP_BASE = 'https://www.meetup.com';

// Meetup serves stripped HTML to obvious crawlers — same playbook as Luma.
// A real Chrome UA gets us the same payload a normal user would see, which
// is what the __NEXT_DATA__ extraction depends on.
const USER_AGENT =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

const HTML_HEADERS = {
    'User-Agent': USER_AGENT,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
};

// Polite gap between per-event detail fetches. Matches the n8n
// "Wait (Rate Limit)1" node's 2s cadence; we use 1.5s to align with
// Luma's EVENT_FETCH_GAP_MS. Bumping this is the first knob to turn if
// Meetup starts rate-limiting.
const EVENT_FETCH_GAP_MS = 1500;

// --- Apollo state shape (subset we use) -----------------------------------------

interface ApolloRef {
    __ref: string;
}

interface ApolloEventEdge {
    node?: ApolloRef;
}

interface ApolloEventsConnection {
    edges?: ApolloEventEdge[];
    totalCount?: number;
}

interface ApolloEvent {
    id?: string;
    title?: string;
    description?: string;
    eventUrl?: string;
    dateTime?: string;
    endTime?: string;
    timezone?: string;
    maxTickets?: number;
    group?: ApolloRef;
    venue?: ApolloRef | ApolloVenue;
    featuredEventPhoto?: ApolloRef | { highResUrl?: string; baseUrl?: string };
    /** rsvps connections keyed by filter, e.g. `rsvps({"filter":{"rsvpStatus":"YES"}})`. */
    [k: string]: unknown;
}

interface ApolloGroup {
    id?: string;
    name?: string;
    urlname?: string;
    city?: string;
    [k: string]: unknown; // events(...) connection keys live here too
}

interface ApolloVenue {
    name?: string | null;
    address?: string | null;
    city?: string | null;
    lat?: number | null;
    lng?: number | null;
    /** Some Meetup payloads use `lon` instead of `lng`. Defensive both ways. */
    lon?: number | null;
}

interface ApolloPhoto {
    highResUrl?: string;
    baseUrl?: string;
}

type ApolloState = Record<string, ApolloEvent | ApolloGroup | ApolloVenue | ApolloPhoto | ApolloEventsConnection | unknown>;

interface NextData {
    props?: {
        pageProps?: {
            __APOLLO_STATE__?: ApolloState;
        };
    };
}

// --- HTML / NEXT_DATA helpers ---------------------------------------------------

const NEXT_DATA_RE = /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i;

function parseNextData(html: string): NextData | null {
    const match = html.match(NEXT_DATA_RE);
    if (!match) return null;
    try {
        return JSON.parse(match[1].replace(/[\r\n]+/g, '').trim()) as NextData;
    } catch (err) {
        console.warn('[meetup] failed to parse __NEXT_DATA__:', err instanceof Error ? err.message : err);
        return null;
    }
}

async function fetchHtml(url: string, label: string): Promise<string | null> {
    let res: Response;
    try {
        res = await fetch(url, { headers: HTML_HEADERS, redirect: 'follow' });
    } catch (err) {
        console.warn(`[meetup] network error for ${label} ${url}:`, err instanceof Error ? err.message : err);
        return null;
    }
    if (!res.ok) {
        console.warn(`[meetup] fetch ${label} ${url} → HTTP ${res.status}`);
        return null;
    }
    return await res.text();
}

// --- URL helpers ----------------------------------------------------------------

export function normalizeMeetupPath(input: string): string {
    return input
        .trim()
        .replace(/^https?:\/\//i, '')
        .replace(/^www\.meetup\.com\//i, '')
        .replace(/^meetup\.com\//i, '')
        .replace(/^\/+/, '')
        .replace(/[?#].*$/, '')
        .replace(/\/+$/, '');
}

export function eventUrlFromIds(urlname: string, eventId: string): string {
    return `${MEETUP_BASE}/${urlname}/events/${eventId}/`;
}

function extractEventIdFromUrl(eventUrl: string | undefined): string | null {
    if (!eventUrl) return null;
    const m = eventUrl.match(/\/events\/(\d+)/);
    return m ? m[1] : null;
}

function resolveRef<T>(state: ApolloState, ref: ApolloRef | T | undefined): T | null {
    if (!ref) return null;
    if (typeof ref === 'object' && ref !== null && '__ref' in (ref as Record<string, unknown>)) {
        const key = (ref as ApolloRef).__ref;
        return (state[key] as T) ?? null;
    }
    return ref as T;
}

// --- Event-list extraction (group page) ----------------------------------------

interface EventStub {
    eventId: string;
    eventUrl: string;
}

/**
 * Walk the Apollo state on a group's events page and return refs to the
 * upcoming events. Mirrors the n8n "Extract Event URLs from Group Page" node:
 * prefer Group entities' `events(...)` connections (which carry the upcoming
 * filter applied by the page); fall back to walking every Event entity.
 */
function extractEventStubsFromGroupPage(html: string): EventStub[] {
    const nextData = parseNextData(html);
    const state = nextData?.props?.pageProps?.__APOLLO_STATE__;
    if (!state) return [];

    const seen = new Set<string>();
    const out: EventStub[] = [];

    const pushFromEventUrl = (eventUrl: string | undefined) => {
        const id = extractEventIdFromUrl(eventUrl);
        if (!id || seen.has(id)) return;
        const path = eventUrl!.startsWith('http') ? eventUrl!.replace(MEETUP_BASE, '') : eventUrl!;
        seen.add(id);
        out.push({ eventId: id, eventUrl: `${MEETUP_BASE}${path}` });
    };

    // Method 1: Group entities have GraphQL-keyed events(...) connections
    // whose edges point at Event entities by __ref. These reflect the
    // page's "upcoming events" filter as applied server-side.
    for (const key of Object.keys(state)) {
        if (!key.startsWith('Group:')) continue;
        const group = state[key] as ApolloGroup;
        for (const prop of Object.keys(group)) {
            if (!prop.startsWith('events(')) continue;
            const conn = group[prop] as ApolloEventsConnection | undefined;
            for (const edge of conn?.edges ?? []) {
                const eventEntity = resolveRef<ApolloEvent>(state, edge.node);
                pushFromEventUrl(eventEntity?.eventUrl);
            }
        }
    }

    if (out.length > 0) return out;

    // Method 2: walk all Event: entries directly. Used when the group page
    // doesn't expose its events connection in the Apollo state shape we
    // expect (newer Apollo cache layouts, A/B variations).
    for (const key of Object.keys(state)) {
        if (!key.startsWith('Event:')) continue;
        const event = state[key] as ApolloEvent;
        pushFromEventUrl(event.eventUrl);
    }

    return out;
}

// --- Event detail extraction ---------------------------------------------------

function readGoingCount(event: ApolloEvent): number | null {
    // rsvps connections are keyed by filter args, e.g.
    //   rsvps({"filter":{"rsvpStatus":"YES"},...})
    // The exact JSON varies by paging args; we match the YES filter by substring.
    for (const key of Object.keys(event)) {
        if (!key.startsWith('rsvps(')) continue;
        if (!key.includes('YES')) continue;
        const conn = event[key] as { totalCount?: number } | undefined;
        if (typeof conn?.totalCount === 'number') return conn.totalCount;
    }
    // Older shapes occasionally surface a flat going.totalCount.
    const fallback = (event as unknown as { going?: { totalCount?: number }; goingCount?: { totalCount?: number } });
    return fallback.going?.totalCount ?? fallback.goingCount?.totalCount ?? null;
}

function readPhotoUrl(event: ApolloEvent, state: ApolloState): string | null {
    const inline = event.featuredEventPhoto;
    if (inline && typeof inline === 'object') {
        // Direct object case (some payloads).
        if ('highResUrl' in inline && typeof (inline as ApolloPhoto).highResUrl === 'string') {
            return (inline as ApolloPhoto).highResUrl ?? null;
        }
        if ('baseUrl' in inline && typeof (inline as ApolloPhoto).baseUrl === 'string') {
            return (inline as ApolloPhoto).baseUrl ?? null;
        }
        // Reference case.
        if ('__ref' in (inline as Record<string, unknown>)) {
            const photo = resolveRef<ApolloPhoto>(state, inline as ApolloRef);
            return photo?.highResUrl ?? photo?.baseUrl ?? null;
        }
    }
    return null;
}

function readVenue(event: ApolloEvent, state: ApolloState): MeetupVenue | null {
    const venue = resolveRef<ApolloVenue>(state, event.venue);
    if (!venue) return null;
    return {
        name: venue.name ?? null,
        address: venue.address ?? null,
        city: venue.city ?? null,
        lat: typeof venue.lat === 'number' ? venue.lat : null,
        lng: typeof venue.lng === 'number' ? venue.lng : (typeof venue.lon === 'number' ? venue.lon : null),
    };
}

function buildLocationString(venue: MeetupVenue | null, group: MeetupGroup): string | null {
    if (!venue) return group.city ?? 'Cebu City, Philippines';
    if (venue.name) {
        const parts = [venue.name];
        if (venue.address) parts.push(venue.address);
        if (venue.city && venue.city !== 'Cebu City') parts.push(venue.city);
        return parts.join(', ');
    }
    if (venue.address) return `${venue.address}, ${venue.city ?? 'Cebu City'}`;
    return venue.city ?? group.city ?? 'Cebu City, Philippines';
}

// Strip out the most common HTML entities + Markdown emphasis. Meetup's
// description field is rich-text-as-HTML — leaving the tags raw makes the
// PWA render them as visible escapes. We also collapse markdown that doesn't
// add value (bold/italic/links) so the description stays readable in plain
// text. Matches the n8n "Prepare Event Data for Supabase1" cleanup.
function cleanDescription(raw: string | undefined | null): string | null {
    if (!raw) return null;
    const cleaned = raw
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/\*([^*]+)\*/g, '$1')
        .replace(/__([^_]+)__/g, '$1')
        .replace(/_([^_]+)_/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .trim()
        .substring(0, 5000);
    return cleaned || null;
}

function isFutureEvent(dateTime: string | undefined, now: Date): boolean {
    if (!dateTime) return false;
    const d = new Date(dateTime).getTime();
    if (!Number.isFinite(d)) return false;
    return d > now.getTime();
}

/**
 * Pull a single event from a meetup.com event detail page. Returns null when
 * the page lacks the Event entity, or when the event is in the past.
 */
export async function fetchMeetupEvent(eventUrl: string): Promise<MeetupEvent | null> {
    const html = await fetchHtml(eventUrl, 'event');
    if (!html) return null;
    const nextData = parseNextData(html);
    const state = nextData?.props?.pageProps?.__APOLLO_STATE__;
    if (!state) {
        console.warn(`[meetup] no __APOLLO_STATE__ on ${eventUrl}`);
        return null;
    }

    const eventId = extractEventIdFromUrl(eventUrl);
    if (!eventId) return null;

    // Find the matching Event entity. The key embeds the id, e.g.
    // `Event:314037992`, but Apollo cache layouts vary across versions, so
    // we match on substring rather than constructing the exact key.
    let event: ApolloEvent | null = null;
    for (const key of Object.keys(state)) {
        if (key.startsWith('Event:') && key.includes(eventId)) {
            event = state[key] as ApolloEvent;
            break;
        }
    }
    if (!event || !event.title || !event.dateTime) {
        console.warn(`[meetup] event ${eventId} not found or missing core fields on ${eventUrl}`);
        return null;
    }

    if (!isFutureEvent(event.dateTime, new Date())) {
        // Past event — caller is bounded by upcoming-event count.
        return null;
    }

    const groupRef = resolveRef<ApolloGroup>(state, event.group);
    const group: MeetupGroup = {
        urlname: groupRef?.urlname ?? '',
        name: groupRef?.name ?? '',
        avatar: null,
        city: groupRef?.city ?? null,
    };
    if (!group.urlname || !group.name) {
        console.warn(`[meetup] event ${eventId} has no group attribution`);
        return null;
    }

    const venue = readVenue(event, state);
    const photo = readPhotoUrl(event, state);

    return {
        meetup_id: eventId,
        url: eventUrl,
        name: event.title,
        description: cleanDescription(event.description),
        start_time: event.dateTime,
        end_time: event.endTime ?? null,
        timezone: event.timezone ?? null,
        location: buildLocationString(venue, group),
        location_details: venue && venue.lat != null && venue.lng != null
            ? { latitude: venue.lat, longitude: venue.lng }
            : null,
        cover_photo: photo,
        group,
        going_count: readGoingCount(event),
        max_tickets: typeof event.maxTickets === 'number' ? event.maxTickets : null,
        venue,
    };
}

// --- Public: list events for a group --------------------------------------------

/**
 * Fetch a group's events page and return fully-detailed upcoming events.
 * Per-event detail fetch is sequential with EVENT_FETCH_GAP_MS gap to avoid
 * tripping Meetup's bot defenses on busy groups.
 */
export async function fetchEventsForMeetupGroup(urlname: string): Promise<MeetupEvent[]> {
    const slug = normalizeMeetupPath(urlname);
    const groupUrl = `${MEETUP_BASE}/${slug}/events/`;
    const html = await fetchHtml(groupUrl, 'group');
    if (!html) return [];

    const stubs = extractEventStubsFromGroupPage(html);
    if (stubs.length === 0) {
        console.log(`[meetup] group ${slug} — no event stubs in Apollo state (group missing or no upcoming events)`);
        return [];
    }
    console.log(`[meetup] group ${slug} — ${stubs.length} candidate event(s); fetching details`);

    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const events: MeetupEvent[] = [];
    for (let i = 0; i < stubs.length; i++) {
        const stub = stubs[i];
        const detailed = await fetchMeetupEvent(stub.eventUrl);
        if (detailed) events.push(detailed);
        if (i < stubs.length - 1) await sleep(EVENT_FETCH_GAP_MS);
    }
    console.log(`[meetup] group ${slug} — ${events.length} future event(s) of ${stubs.length} stubs`);
    return events;
}
