import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { LumaEvent, LumaPresenter } from './types.ts';

const LUMA_BASE = 'https://luma.com';
const LUMA_API_BASE = 'https://api2.luma.com';

// Luma's CDN serves stripped HTML to obvious crawlers — sending a real Chrome
// UA gets us the same payload a normal user would see, which is what the
// __NEXT_DATA__ extraction depends on.
const USER_AGENT =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

const HTML_HEADERS = {
    'User-Agent': USER_AGENT,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
};

const JSON_HEADERS = {
    'User-Agent': USER_AGENT,
    'Accept': 'application/json',
};

// Polite gap between per-event detail fetches (matches the proven n8n cadence).
const EVENT_FETCH_GAP_MS = 1500;

// --- Raw shapes from Luma's __NEXT_DATA__ blob ----------------------------------

interface NextDataGeoAddress {
    name?: string | null;
    city?: string | null;
    region?: string | null;
    country?: string | null;
    full_address?: string | null;
    latitude?: number | null;
    longitude?: number | null;
}

interface NextDataEvent {
    api_id: string;
    name: string;
    url: string;
    start_at: string;
    end_at?: string | null;
    timezone?: string | null;
    cover_url?: string | null;
    description?: string | null;
    location?: string | null;
    location_type?: string | null;
    geo_address_info?: NextDataGeoAddress | null;
    hosts?: NextDataHostWrapper[];
}

interface NextDataDescriptionMirrorNode {
    text?: string;
    content?: NextDataDescriptionMirrorNode[];
}

interface NextDataHost {
    api_id?: string;
    name?: string;
    avatar_url?: string | null;
    avatar?: string | null;
}

interface NextDataHostWrapper {
    user?: NextDataHost;
    api_id?: string;
    name?: string;
    avatar_url?: string | null;
}

interface NextDataCalendar {
    api_id?: string;
    name?: string;
    avatar_url?: string | null;
    slug?: string;
    is_personal?: boolean;
    personal_user?: NextDataHost | null;
    /** Calendar's geographic anchor — used as the city/region/country for
     * online events whose own geo_address_info is empty. */
    city?: string | null;
    geo_city?: string | null;
    geo_region?: string | null;
    geo_country?: string | null;
}

interface NextData {
    props?: {
        pageProps?: {
            initialData?: {
                data?: {
                    event?: NextDataEvent;
                    calendar?: NextDataCalendar;
                    featured_items?: Array<{ event: NextDataEvent; calendar?: NextDataCalendar }>;
                    description_mirror?: { content?: NextDataDescriptionMirrorNode[] };
                    hosts?: NextDataHostWrapper[];
                };
                user?: {
                    api_id: string;
                    name: string;
                };
            };
        };
    };
}

interface ApiUserHostingResponse {
    entries?: Array<{ event: NextDataEvent }>;
}

interface LumaEventStub {
    event: NextDataEvent;
    calendar?: NextDataCalendar;
    presenters?: LumaPresenter[];
}

// --- Path / URL helpers ---------------------------------------------------------

/** Strip protocol/host/trailing slashes — turn any Luma reference into a bare path. */
export function normalizeLumaPath(input: string): string {
    return input
        .trim()
        .replace(/^https?:\/\//i, '')
        .replace(/^lu\.ma\//i, '')
        .replace(/^luma\.com\//i, '')
        .replace(/^\/+/, '')
        .replace(/[?#].*$/, '')
        .replace(/\/+$/, '');
}

export function pathToCanonicalUrl(path: string): string {
    return `${LUMA_BASE}/${normalizeLumaPath(path)}`;
}

function isUserPath(path: string): boolean {
    return /^user\//i.test(normalizeLumaPath(path));
}

// --- __NEXT_DATA__ extraction ---------------------------------------------------

const NEXT_DATA_RE = /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i;

function parseNextData(html: string): NextData | null {
    const match = html.match(NEXT_DATA_RE);
    if (!match) return null;
    try {
        const cleaned = match[1].replace(/[\r\n]+/g, '').trim();
        return JSON.parse(cleaned) as NextData;
    } catch (err) {
        console.warn('[luma] failed to parse __NEXT_DATA__:', err instanceof Error ? err.message : err);
        return null;
    }
}

async function fetchHtml(url: string, label: string): Promise<string | null> {
    let res: Response;
    try {
        res = await fetch(url, { headers: HTML_HEADERS });
    } catch (err) {
        console.warn(`[luma] network error for ${label} ${url}:`, err instanceof Error ? err.message : err);
        return null;
    }
    if (!res.ok) {
        console.warn(`[luma] fetch ${label} ${url} → HTTP ${res.status}`);
        return null;
    }
    return await res.text();
}

// --- Description extraction (rich-text tree → plain text) -----------------------

// Defensively extract hosts from __NEXT_DATA__. Luma stores these in different
// shapes depending on the page (data.hosts vs data.event.hosts; entries can be
// flat {api_id, name} or wrapped {user: {api_id, name}}). We walk every plausible
// location and dedupe by api_id so the caller doesn't have to care.
function collectHosts(
    eventHosts?: NextDataHostWrapper[] | NextDataHost[],
    pageHosts?: NextDataHostWrapper[],
): Array<{ api_id: string; name: string; avatar: string | null }> {
    const out: Array<{ api_id: string; name: string; avatar: string | null }> = [];
    const seen = new Set<string>();
    const sources = [eventHosts, pageHosts];
    for (const list of sources) {
        if (!Array.isArray(list)) continue;
        for (const entry of list) {
            const inner = (entry as NextDataHostWrapper).user ?? (entry as NextDataHost);
            const api_id = inner?.api_id;
            const name = inner?.name;
            if (!api_id || !name || seen.has(api_id)) continue;
            seen.add(api_id);
            out.push({
                api_id,
                name,
                avatar: inner.avatar_url ?? (inner as NextDataHost).avatar ?? null,
            });
        }
    }
    return out;
}

/**
 * Map __NEXT_DATA__ to the "Presented by" attribution Cebby displays.
 * Non-personal calendars are the presenting community. Personal calendars are
 * Luma containers for user-hosted events; their host entries belong to Luma's
 * separate "Hosted By" section and are not presenter attribution.
 */
function determinePresenters(calendar: NextDataCalendar | undefined): LumaPresenter[] {
    if (calendar?.api_id && calendar.name && !calendar.is_personal) {
        return [{
            api_id: calendar.api_id,
            name: calendar.name,
            kind: 'luma_calendar',
            avatar: calendar.avatar_url ?? null,
        }];
    }
    return [];
}

function calendarToPresenter(calendar: NextDataCalendar | undefined): LumaPresenter | null {
    if (!calendar?.api_id || !calendar.name || calendar.is_personal) return null;

    return {
        api_id: calendar.api_id,
        name: calendar.name,
        kind: 'luma_calendar',
        avatar: calendar.avatar_url ?? null,
    };
}

function dedupePresenters(presenters: LumaPresenter[]): LumaPresenter[] {
    const out: LumaPresenter[] = [];
    const seen = new Set<string>();
    for (const presenter of presenters) {
        if (seen.has(presenter.api_id)) continue;
        seen.add(presenter.api_id);
        out.push(presenter);
    }
    return out;
}

function primaryPresenter(presenters: LumaPresenter[]): LumaPresenter | null {
    return presenters[0] ?? null;
}

// Walk Luma's rich-text description tree into plain text, preserving paragraph
// breaks. Each top-level node is one paragraph; we join with `\n\n` so the
// PWA's `whitespace-pre-wrap` rendering shows them as actual paragraphs (one
// blank line between). The previous single-`\n` collapse made the description
// read as one wall of text.
function descriptionMirrorToText(nodes: NextDataDescriptionMirrorNode[] | undefined): string {
    if (!nodes || !Array.isArray(nodes)) return '';
    const paragraphs: string[] = [];
    for (const block of nodes) {
        if (!block.content || !Array.isArray(block.content)) continue;
        let text = '';
        for (const inner of block.content) {
            if (inner.text) text += inner.text;
            if (inner.content) text += descriptionMirrorToText(inner.content);
        }
        const trimmed = text.trim();
        if (trimmed) paragraphs.push(trimmed);
    }
    return paragraphs.join('\n\n');
}

// --- Event mapping --------------------------------------------------------------

function mapNextDataEventToLumaEvent(
    event: NextDataEvent,
    pageData?: {
        description_mirror?: { content?: NextDataDescriptionMirrorNode[] };
        hosts?: NextDataHostWrapper[];
        calendar?: NextDataCalendar;
    },
): LumaEvent | null {
    if (!event.api_id || !event.url || !event.name || !event.start_at) return null;

    const slug = normalizeLumaPath(event.url);
    const geo = event.geo_address_info;

    // Display-label mapping for non-physical events. Luma uses several
    // location_type values for virtual events; map each to a friendly label
    // rather than dropping the field entirely (which is what happened for
    // 'meet'/'teams' before this).
    const VIRTUAL_LABELS: Record<string, string> = {
        zoom: 'Online (Zoom)',
        meet: 'Online (Google Meet)',
        teams: 'Online (Teams)',
        online: 'Online',
    };

    const hasPhysicalAddress = !!geo && !!(geo.full_address || geo.city || geo.name);

    let location: string | null;
    if (hasPhysicalAddress) {
        location = geo.full_address || geo.city || geo.name || null;
    } else if (event.location_type && event.location_type !== 'offline') {
        location = VIRTUAL_LABELS[event.location_type] ?? 'Online';
    } else {
        location = event.location || null;
    }

    const richDescription = pageData?.description_mirror?.content
        ? descriptionMirrorToText(pageData.description_mirror.content)
        : '';
    const description = (richDescription || event.description || '').slice(0, 5000) || null;

    // Geographic anchors. Prefer the event's own geo_address_info when it's a
    // physical event; fall back to the calendar's geo for online events so a
    // Cebu-anchored community's online events still tag as 'Cebu City'.
    const cal = pageData?.calendar;
    const city = geo?.city ?? cal?.geo_city ?? cal?.city ?? null;
    const region = geo?.region ?? cal?.geo_region ?? null;
    const country = geo?.country ?? cal?.geo_country ?? null;
    const presenters = dedupePresenters(determinePresenters(cal));

    return {
        api_id: event.api_id,
        slug,
        url: `${LUMA_BASE}/${slug}`,
        name: event.name,
        description,
        start_time: event.start_at,
        end_time: event.end_at ?? null,
        timezone: event.timezone ?? null,
        cover_photo: event.cover_url ?? null,
        location,
        location_type: event.location_type ?? null,
        location_details: geo?.latitude != null && geo?.longitude != null
            ? { latitude: geo.latitude, longitude: geo.longitude }
            : null,
        city,
        region,
        country,
        presenters,
        presenter: primaryPresenter(presenters),
        hosts: collectHosts(event.hosts, pageData?.hosts),
    };
}

function isFutureEvent(event: NextDataEvent, now: Date): boolean {
    if (!event.start_at) return false;
    const startTime = new Date(event.start_at);
    if (Number.isNaN(startTime.getTime())) return false;
    return startTime > now;
}

/**
 * Set LUMA_INCLUDE_PAST=1 in the function's env to disable the future-only
 * filter for one cron run. Useful for backfilling attribution on events
 * inserted before the multi-org migration (those have no event_organizers
 * row and need re-ingestion to acquire one). Default behavior unchanged.
 */
function shouldFilterPast(): boolean {
    const flag = Deno.env.get('LUMA_INCLUDE_PAST');
    return flag !== '1' && flag !== 'true';
}

// --- Public: raw __NEXT_DATA__ access (debugging / introspection) -------------

/**
 * Fetch a Luma page and return the parsed __NEXT_DATA__ JSON unmodified.
 * Useful for diagnostics when the canonical extraction paths return nothing —
 * lets you see what shape Luma is actually serving so you can adjust the
 * walks in this file.
 */
export async function fetchLumaPageData(pathOrUrl: string): Promise<unknown | null> {
    const url = pathToCanonicalUrl(pathOrUrl);
    const html = await fetchHtml(url, 'page');
    if (!html) return null;
    return parseNextData(html);
}

// --- Public: fetch a single event ----------------------------------------------

/**
 * Fetch a Luma event page and extract the full event via __NEXT_DATA__.
 * Returns null if the page is not a Luma event or __NEXT_DATA__ is missing/malformed.
 */
export async function fetchLumaEvent(eventUrlOrPath: string): Promise<LumaEvent | null> {
    const path = normalizeLumaPath(eventUrlOrPath);
    const url = pathToCanonicalUrl(path);
    const html = await fetchHtml(url, 'event');
    if (!html) return null;

    const nextData = parseNextData(html);
    const event = nextData?.props?.pageProps?.initialData?.data?.event;
    if (!event) {
        console.warn(`[luma] no event in __NEXT_DATA__ for ${url}`);
        return null;
    }

    const data = nextData?.props?.pageProps?.initialData?.data;
    return mapNextDataEventToLumaEvent(event, {
        description_mirror: data?.description_mirror,
        hosts: data?.hosts,
        calendar: data?.calendar,
    });
}

// --- Public: list events from a calendar (server-rendered) ----------------------

/**
 * Extract upcoming-event refs from a Luma calendar page (e.g. luma.com/awsugcebu).
 * Returns slim event records — call fetchLumaEvent(slug) per item to get full
 * details (description_mirror is only on the event detail page).
 */
async function fetchCalendarEventStubs(calendarPath: string): Promise<LumaEventStub[]> {
    const url = pathToCanonicalUrl(calendarPath);
    const html = await fetchHtml(url, 'calendar');
    if (!html) return [];

    const nextData = parseNextData(html);
    const pageData = nextData?.props?.pageProps?.initialData?.data;
    if (!pageData) {
        console.warn(`[luma] no initialData.data on calendar page ${url}`);
        return [];
    }

    // Distinguish "calendar genuinely empty" from "extraction maybe broken"
    // by surfacing Luma's own has_upcoming_events flag — clearer log story
    // when an active account's calendar happens to be between events.
    const hasUpcoming = (pageData as { has_upcoming_events?: boolean }).has_upcoming_events;
    if (hasUpcoming === false) {
        console.log(`[luma] calendar ${calendarPath} — Luma reports no upcoming events`);
        return [];
    }

    const featured = pageData.featured_items ?? [];
    const now = new Date();
    const seen = new Set<string>();
    const future: LumaEventStub[] = [];
    for (const item of featured) {
        const event = item.event;
        if (!event?.api_id || seen.has(event.api_id)) continue;
        seen.add(event.api_id);
        if (!shouldFilterPast() || isFutureEvent(event, now)) {
            const calendar = item.calendar ?? pageData.calendar;
            const presenter = calendarToPresenter(calendar);
            future.push({
                event,
                calendar,
                presenters: presenter ? [presenter] : undefined,
            });
        }
    }
    console.log(`[luma] calendar ${calendarPath} — ${future.length} future event(s) of ${featured.length} featured`);
    return future;
}

// --- Public: list events from a user profile (client-rendered → API) -----------

/**
 * Extract user.api_id from a luma.com/user/{handle} page, then call Luma's
 * api2 events-hosting endpoint to list their upcoming events.
 */
async function fetchUserProfileEventStubs(userPath: string): Promise<LumaEventStub[]> {
    const url = pathToCanonicalUrl(userPath);
    const html = await fetchHtml(url, 'user-profile');
    if (!html) return [];

    const nextData = parseNextData(html);

    // Luma serves the 404 page with HTTP 200 (the SPA renders the not-found
    // state client-side), so the only reliable signal is pageProps.status
    // and/or initialData being null. Surface this as a config error rather
    // than letting it blend into generic "no events" output — most often
    // means the handle in account_details.path is stale.
    const pageProps = nextData?.props?.pageProps as
        | { status?: number; initialData?: unknown }
        | undefined;
    if (pageProps?.status === 404 || pageProps?.initialData === null) {
        console.warn(
            `[luma] user "${userPath}" not found on Luma (status=${
                pageProps?.status ?? 'null-data'
            }) — check account_details.path`,
        );
        return [];
    }

    const user = nextData?.props?.pageProps?.initialData?.user;
    if (!user?.api_id) {
        console.warn(`[luma] no user.api_id on profile page ${url}`);
        return [];
    }
    console.log(`[luma] user profile ${userPath} → ${user.name} (${user.api_id})`);

    const apiUrl =
        `${LUMA_API_BASE}/user/profile/events-hosting?pagination_limit=50&period=future&user_api_id=${user.api_id}`;
    let res: Response;
    try {
        res = await fetch(apiUrl, { headers: JSON_HEADERS });
    } catch (err) {
        console.warn(`[luma] api2 fetch failed for ${user.api_id}:`, err instanceof Error ? err.message : err);
        return [];
    }
    if (!res.ok) {
        console.warn(`[luma] api2 ${apiUrl} → HTTP ${res.status}`);
        return [];
    }

    const body = (await res.json()) as ApiUserHostingResponse;
    const entries = body.entries ?? [];
    const now = new Date();
    const seen = new Set<string>();
    const future: LumaEventStub[] = [];
    for (const entry of entries) {
        const event = entry.event;
        if (!event?.api_id || seen.has(event.api_id)) continue;
        seen.add(event.api_id);
        if (!shouldFilterPast() || isFutureEvent(event, now)) {
            future.push({ event });
        }
    }
    console.log(`[luma] user ${userPath} — ${future.length} future event(s) of ${entries.length} entries`);
    return future;
}

// --- Public: top-level orchestration -------------------------------------------

/**
 * Resolve a Luma path (calendar slug like "awsugcebu" OR user handle like
 * "user/lisksea") to a list of fully-detailed upcoming LumaEvent records.
 *
 * Per-event detail fetch is sequential with a polite gap so we don't hammer
 * lu.ma's CDN on busy calendars.
 */
export async function fetchEventsForLumaPath(path: string): Promise<LumaEvent[]> {
    const normalized = normalizeLumaPath(path);
    const stubs = isUserPath(normalized)
        ? await fetchUserProfileEventStubs(normalized)
        : await fetchCalendarEventStubs(normalized);

    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const events: LumaEvent[] = [];
    for (let i = 0; i < stubs.length; i++) {
        const stub = stubs[i];
        const detailed = await fetchLumaEvent(stub.event.url);
        if (detailed) {
            events.push(detailed);
        } else {
            // Stub had enough data to register the event — fall back to the stub
            // so we don't drop events whose detail page failed to fetch. Preserve
            // calendar context from calendar pages so attribution remains
            // "Presented by <calendar>", not the first individual host.
            const fallback = mapNextDataEventToLumaEvent(stub.event, { calendar: stub.calendar });
            if (fallback && stub.presenters && stub.presenters.length > 0) {
                fallback.presenters = dedupePresenters(stub.presenters);
                fallback.presenter = primaryPresenter(fallback.presenters);
            }
            if (fallback) events.push(fallback);
        }
        if (i < stubs.length - 1) await sleep(EVENT_FETCH_GAP_MS);
    }
    return events;
}
