// Keyless reads of Eventbrite organizers, through the endpoints Eventbrite's
// own pages call (checked 2026-11-05; see the spec's Evidence section,
// docs/superpowers/specs/2026-11-05-eventbrite-finding-design.md). They are
// undocumented and can change: every failure comes back as a ReadFailure so the
// finding line on /status says so instead of reading as "nothing upcoming".
import { httpFailure, type ReadFailure } from '@service/core/supabase/shared/health-checks.ts';
import type { PhysicalPlace } from '@service/core/supabase/shared/cebu-rule.ts';
import { HTML_HEADERS } from './eventbriteutils.ts';

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

/** One upcoming event from an organizer's list. A series appears once, under its parent id. */
export interface ListedEvent {
    id: string;
    name: string;
    url: string;
    isOnline: boolean;
    isCancelled: boolean;
    /** The venue's place, `address` being Eventbrite's one-line address; null when it has none. */
    venue: PhysicalPlace | null;
}

export interface SeriesDate {
    id: string;
    startUtc: string;
}

/** A failed read, with its cause, thrown by the lookups that return plain values. */
export class EventbriteReadError extends Error {
    constructor(readonly failure: ReadFailure) {
        super(failure.detail);
    }
}

/** Pages of 50 read per organizer at most, so a list that never ends can't hold a run. */
export const E1_PAGE_CAP = 5;

const BASE = 'https://www.eventbrite.com';
const JSON_HEADERS = {
    'User-Agent': HTML_HEADERS['User-Agent'],
    'Accept': 'application/json',
    'Accept-Language': HTML_HEADERS['Accept-Language'],
};

type JsonResult = { ok: true; body: Record<string, unknown> } | { ok: false; failure: ReadFailure };

/** GET a JSON endpoint; any HTTP error, network error or non-JSON answer is a failure. */
async function getJson(url: string, what: string, fetchFn: FetchFn): Promise<JsonResult> {
    let res: Response;
    try {
        res = await fetchFn(url, { headers: JSON_HEADERS, redirect: 'follow' });
    } catch (error) {
        return { ok: false, failure: { code: 'fetch_failed', detail: `${what}: ${errorText(error)}` } };
    }
    if (!res.ok) return { ok: false, failure: httpFailure(res.status, what) };
    const type = res.headers.get('content-type') ?? '';
    if (!type.includes('json')) {
        return { ok: false, failure: { code: 'unexpected_page', detail: `${what}: ${type || 'no content type'}` } };
    }
    try {
        const body = await res.json();
        if (body && typeof body === 'object' && !Array.isArray(body)) return { ok: true, body };
    } catch (error) {
        return { ok: false, failure: { code: 'unexpected_page', detail: `${what}: ${errorText(error)}` } };
    }
    return { ok: false, failure: { code: 'unexpected_page', detail: `${what}: not a JSON object` } };
}

function errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function str(value: unknown): string | null {
    if (typeof value === 'string' && value.trim()) return value;
    if (typeof value === 'number') return String(value);
    return null;
}

function toVenue(raw: unknown): PhysicalPlace | null {
    if (!raw || typeof raw !== 'object') return null;
    const address = (raw as { address?: Record<string, unknown> }).address;
    if (!address || typeof address !== 'object') return null;
    return {
        city: str(address.city),
        region: str(address.region),
        country: str(address.country),
        address: str(address.localized_address_display),
    };
}

function toListedEvent(raw: Record<string, unknown>): ListedEvent | null {
    const id = str(raw.id);
    if (!id) return null;
    return {
        id,
        name: str(raw.name) ?? '',
        url: str(raw.url) ?? `${BASE}/e/${id}`,
        isOnline: raw.is_online_event === true,
        isCancelled: raw.is_cancelled === true,
        venue: toVenue(raw.primary_venue),
    };
}

/** E2: whether the organizer exists, and its name. Its events list can't tell a bad id from a quiet organizer. */
export async function fetchOrganizer(
    id: string,
    fetchFn: FetchFn = fetch,
): Promise<{ ok: true; name: string } | { ok: false; failure: ReadFailure }> {
    const res = await getJson(`${BASE}/api/v3/organizers/${encodeURIComponent(id)}/`, `organizer ${id}`, fetchFn);
    if (!res.ok) return res;
    return { ok: true, name: str(res.body.name) ?? '' };
}

/**
 * E1: the organizer's upcoming events, every page up to E1_PAGE_CAP. A JSON
 * answer with an `events` array means the organizer was read, even when empty.
 */
export async function listOrganizerEvents(
    id: string,
    fetchFn: FetchFn = fetch,
): Promise<{ ok: true; events: ListedEvent[] } | { ok: false; failure: ReadFailure }> {
    const events: ListedEvent[] = [];
    for (let page = 1; page <= E1_PAGE_CAP; page++) {
        const url = `${BASE}/organizer-profile/api/organizers/${encodeURIComponent(id)}/events/?page=${page}&pageSize=50`;
        const res = await getJson(url, `organizer ${id} events page ${page}`, fetchFn);
        if (!res.ok) return res;
        if (!Array.isArray(res.body.events)) {
            return { ok: false, failure: { code: 'unexpected_page', detail: `organizer ${id} events: no events list` } };
        }
        for (const raw of res.body.events) {
            const event = raw && typeof raw === 'object' ? toListedEvent(raw as Record<string, unknown>) : null;
            if (event) events.push(event);
        }
        if (res.body.hasMore !== true) break;
    }
    return { ok: true, events };
}

/** E3: whether an event is a series parent, whose dates are separate events. Throws EventbriteReadError when it can't tell. */
export async function isSeriesParent(eventId: string, fetchFn: FetchFn = fetch): Promise<boolean> {
    const res = await getJson(`${BASE}/api/v3/events/${encodeURIComponent(eventId)}/`, `event ${eventId}`, fetchFn);
    if (!res.ok) throw new EventbriteReadError(res.failure);
    return res.body.is_series_parent === true;
}

/**
 * E4: a series' current and future dates that are on sale (live or started, and
 * listed), earliest first, each with its own event id. Throws EventbriteReadError on failure.
 */
export async function fetchSeriesDates(parentId: string, fetchFn: FetchFn = fetch): Promise<SeriesDate[]> {
    const url = `${BASE}/api/v3/series/${encodeURIComponent(parentId)}/events/?time_filter=current_future&order_by=start_asc`;
    const res = await getJson(url, `series ${parentId}`, fetchFn);
    if (!res.ok) throw new EventbriteReadError(res.failure);
    if (!Array.isArray(res.body.events)) {
        throw new EventbriteReadError({ code: 'unexpected_page', detail: `series ${parentId}: no events list` });
    }
    const dates: SeriesDate[] = [];
    for (const raw of res.body.events as Record<string, unknown>[]) {
        const id = str(raw?.id);
        const startUtc = str((raw?.start as Record<string, unknown> | undefined)?.utc);
        // A cancelled, draft or unlisted date stays in the series list; it isn't an event to show.
        const onSale = (raw?.status === 'live' || raw?.status === 'started') && raw?.listed !== false;
        if (id && startUtc && onSale) dates.push({ id, startUtc });
    }
    return dates;
}
