import type { IngestEvent } from '@service/core/supabase/shared/types.ts';
import type { EventbriteEvent, EventbriteOrganizer, EventbriteVenue } from './types.ts';

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

const HTML_HEADERS = {
    'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
};

/**
 * A scraped Eventbrite page. A series parent's dates span the whole series
 * (e.g. 2026 → 2029), so it must not be imported as a single event.
 */
export type EventbritePage =
    | { kind: 'event'; event: EventbriteEvent }
    | { kind: 'series_parent'; seriesId: string; name: string };

// Without __NEXT_DATA__ there is no explicit parent flag, so a schema.org event
// longer than this is treated as a series parent.
const MAX_SINGLE_EVENT_MS = 7 * 24 * 60 * 60 * 1000;

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | null {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : null;
}

function asString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
    const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
    return Number.isFinite(n) ? n : null;
}

function toIso(value: unknown): string | null {
    const s = asString(value);
    if (!s) return null;
    const date = new Date(s);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** `props.pageProps.context` from the page's __NEXT_DATA__ blob. */
function readNextDataContext(html: string): JsonObject | null {
    const m = html.match(/<script id="__NEXT_DATA__" type="application\/json"[^>]*>([\s\S]*?)<\/script>/);
    if (!m) return null;
    try {
        const data = JSON.parse(m[1]) as { props?: { pageProps?: { context?: unknown } } };
        return asObject(data.props?.pageProps?.context);
    } catch {
        return null;
    }
}

function readJsonLdEvent(html: string): JsonObject | null {
    for (const m of html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
        let data: unknown;
        try {
            data = JSON.parse(m[1]);
        } catch {
            continue;
        }
        for (const item of Array.isArray(data) ? data : [data]) {
            const obj = asObject(item);
            if (obj && String(obj['@type'] ?? '').includes('Event')) return obj;
        }
    }
    return null;
}

/**
 * Eventbrite descriptions are HTML; the PWA renders plain text with blank-line
 * paragraphs, so keep paragraph and list structure and drop the markup.
 */
export function eventbriteHtmlToText(html: string): string {
    return html
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<li[^>]*>/gi, '• ')
        .replace(/<\/li>/gi, '\n')
        .replace(/<\/(p|div|h[1-6]|ul|ol)>/gi, '\n\n')
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function organizerFrom(id: string | null, name: string | null, url: string | null, avatar: string | null): EventbriteOrganizer | null {
    // https://www.eventbrite.com/o/code-orange-dev-school-110850996031
    const path = url?.match(/\/o\/([^/?#]+)/)?.[1] ?? null;
    const accountId = id ?? path?.match(/-(\d+)$/)?.[1] ?? path;
    if (!accountId || !name) return null;
    return { account_id: accountId, name, path: path ?? accountId, avatar };
}

function locationFrom(venue: EventbriteVenue | null, online: boolean): string | null {
    if (online) return 'Online';
    if (!venue) return null;
    return [venue.name, venue.address].filter(Boolean).join(', ') || null;
}

function coordinatesFrom(venue: EventbriteVenue | null): { latitude: number; longitude: number } | null {
    return venue?.lat != null && venue.lng != null ? { latitude: venue.lat, longitude: venue.lng } : null;
}

function fromBasicInfo(info: JsonObject, context: JsonObject, ld: JsonObject | null, url: string): EventbritePage | null {
    const id = asString(info.id);
    const name = asString(info.name);
    if (!id || !name) return null;
    if (info.isParentEvent === true) return { kind: 'series_parent', seriesId: asString(info.seriesId) ?? id, name };

    const start = asObject(info.startDate);
    const startTime = toIso(start?.utc);
    const org = asObject(info.organizer);
    const organizer = org &&
        organizerFrom(asString(org.id), asString(org.name), asString(org.url), asString(org.image) ?? asString(asObject(org.image)?.url));
    if (!startTime || !organizer) return null;

    const online = info.isOnline === true;
    const rawVenue = online ? null : asObject(info.venue);
    const address = asObject(rawVenue?.address);
    const lines = Array.isArray(address?.localizedMultiLineAddressDisplay)
        ? (address.localizedMultiLineAddressDisplay as unknown[]).map(asString).filter(Boolean).join(', ')
        : null;
    const venue: EventbriteVenue | null = rawVenue
        ? {
            name: asString(rawVenue.name),
            address: lines || null,
            city: asString(address?.city),
            region: asString(address?.region),
            country: asString(address?.country),
            lat: asNumber(address?.latitude),
            lng: asNumber(address?.longitude),
        }
        : null;

    const modules = asObject(context.structuredContent)?.modules;
    const descriptionHtml = Array.isArray(modules)
        ? modules.map(asObject).filter((m) => m?.type === 'text').map((m) => asString(m?.text) ?? '').join('\n')
        : '';
    const description = descriptionHtml ? eventbriteHtmlToText(descriptionHtml) : asString(info.summary);

    return {
        kind: 'event',
        event: {
            eventbrite_id: id,
            url,
            name,
            description: description ? description.slice(0, 5000) : null,
            start_time: startTime,
            end_time: toIso(asObject(info.endDate)?.utc),
            timezone: asString(start?.timezone),
            location: locationFrom(venue, online),
            location_details: coordinatesFrom(venue),
            cover_photo: asString(ld?.image),
            is_free: typeof info.isFree === 'boolean' ? info.isFree : null,
            organizer,
            venue,
            raw: info,
        },
    };
}

function fromJsonLd(ld: JsonObject, url: string): EventbritePage | null {
    const name = asString(ld.name);
    const startTime = toIso(ld.startDate);
    const eventId = url.match(/(\d+)\/?$/)?.[1] ?? asString(ld.url)?.match(/(\d+)\/?$/)?.[1];
    if (!name || !startTime || !eventId) return null;

    const endTime = toIso(ld.endDate);
    if (endTime && Date.parse(endTime) - Date.parse(startTime) > MAX_SINGLE_EVENT_MS) {
        return { kind: 'series_parent', seriesId: eventId, name };
    }

    const org = asObject(ld.organizer);
    const organizer = org && organizerFrom(null, asString(org.name), asString(org.url), null);
    if (!organizer) return null;

    const online = String(ld.eventAttendanceMode ?? '').includes('Online');
    const place = online ? null : asObject(ld.location);
    const address = asObject(place?.address);
    const geo = asObject(place?.geo);
    const venue: EventbriteVenue | null = place
        ? {
            name: asString(place.name),
            address: asString(address?.streetAddress),
            city: asString(address?.addressLocality),
            region: asString(address?.addressRegion),
            country: asString(address?.addressCountry),
            lat: asNumber(geo?.latitude),
            lng: asNumber(geo?.longitude),
        }
        : null;
    const offers = (Array.isArray(ld.offers) ? ld.offers : [ld.offers]).map(asObject).filter(Boolean);
    const prices = offers.map((o) => asNumber(o?.lowPrice ?? o?.price)).filter((p): p is number => p != null);

    return {
        kind: 'event',
        event: {
            eventbrite_id: eventId,
            url,
            name,
            description: asString(ld.description),
            start_time: startTime,
            end_time: endTime,
            timezone: null,
            location: locationFrom(venue, online),
            location_details: coordinatesFrom(venue),
            cover_photo: asString(ld.image),
            is_free: prices.length ? prices.every((p) => p === 0) : null,
            organizer,
            venue,
            raw: ld,
        },
    };
}

/**
 * Parse an Eventbrite event page. Prefers the page's __NEXT_DATA__, which flags
 * series parents and carries venue coordinates and the full description, and
 * falls back to the schema.org Event block.
 */
export function parseEventbriteEventPage(html: string, url: string): EventbritePage | null {
    const context = readNextDataContext(html);
    const ld = readJsonLdEvent(html);
    const info = asObject(context?.basicInfo);
    if (context && info) {
        const page = fromBasicInfo(info, context, ld, url);
        if (page) return page;
    }
    return ld ? fromJsonLd(ld, url) : null;
}

/** Fetch and parse one Eventbrite event page. Returns null when the event doesn't exist. */
export async function fetchEventbriteEvent(url: string): Promise<EventbritePage | null> {
    const res = await fetch(url, { headers: HTML_HEADERS, redirect: 'follow' });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Eventbrite page fetch failed: HTTP ${res.status}`);
    return parseEventbriteEventPage(await res.text(), url);
}

/** Map a scraped Eventbrite event to the shared ingest shape. */
export function toIngestEvent(event: EventbriteEvent, organizerAccountId: string): IngestEvent {
    return {
        name: event.name,
        description: event.description,
        start_time: event.start_time,
        end_time: event.end_time,
        timezone: event.timezone,
        format: event.location === 'Online' ? 'online' : 'in_person',
        location: event.location,
        location_details: event.location_details,
        city: event.venue?.city ?? null,
        region: event.venue?.region ?? null,
        country: event.venue?.country ?? null,
        cover_photo: event.cover_photo,
        source: 'eventbrite',
        source_id: event.eventbrite_id,
        source_url: event.url,
        ingest_kind: 'public_scrape',
        raw: event as unknown,
        organizers: [{ account_id: organizerAccountId, role: 'presenter' }],
    };
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
