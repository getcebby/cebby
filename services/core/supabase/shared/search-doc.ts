/**
 * The Typesense search document for an event, shared by the realtime sync
 * edge function (services/typesense/supabase/functions/sync-event) and the
 * nightly batch reindex (apps/pwa/src/scripts/sync-typesense-standalone.ts).
 *
 * Both used to build the document separately and drifted: the batch read v1
 * columns that no longer exist, so every nightly run reset is_online to false
 * and emptied organization and tags until each event's next realtime sync.
 * Build documents only through eventToSearchDoc so the two can't diverge.
 *
 * Pure and dependency-free: runs on Deno (edge) and Node 22 (batch) alike.
 */

/** Supabase select for EventSearchRow — the columns and joins the doc needs. */
export const EVENT_SEARCH_SELECT = `
    id, name, description, start_time, end_time, location, city, status, format,
    is_free, slug, cover_photo,
    organizers:event_organizers(role,position,accounts(name)),
    event_tags(tags(name,slug))
`;

interface OrganizerJoin {
    role: string;
    position: number;
    accounts: { name: string } | null;
}

interface TagJoin {
    tags: { name: string; slug: string } | null;
}

export interface EventSearchRow {
    id: number;
    name: string | null;
    description: string | null;
    start_time: string | null;
    end_time: string | null;
    location: string | null;
    city: string | null;
    status: string | null;
    format: string | null;
    is_free: boolean | null;
    slug: string | null;
    cover_photo: string | null;
    organizers: OrganizerJoin[] | null;
    event_tags: TagJoin[] | null;
}

export interface EventSearchDoc {
    id: string;
    name: string;
    description: string;
    start_time: number;
    end_time?: number;
    location: string;
    /** Normalized city (see normalizeCity); null when unknown or online-only. */
    city: string | null;
    organization: string;
    is_free: boolean;
    is_online: boolean;
    tags: string[];
    slug: string | null;
    cover_photo: string | null;
}

export const eventsCollectionSchema = {
    name: 'events',
    fields: [
        { name: 'name', type: 'string' },
        { name: 'description', type: 'string' },
        { name: 'start_time', type: 'int64' },
        { name: 'end_time', type: 'int64', optional: true },
        { name: 'location', type: 'string' },
        { name: 'city', type: 'string', facet: true, optional: true },
        { name: 'organization', type: 'string' },
        { name: 'is_free', type: 'bool' },
        { name: 'is_online', type: 'bool' },
        { name: 'tags', type: 'string[]' },
        { name: 'slug', type: 'string', optional: true },
        { name: 'cover_photo', type: 'string', optional: true },
    ],
    default_sorting_field: 'start_time',
};

// Other Cebu LGUs. Matched before Cebu City so "Talisay City, Cebu" isn't
// filed under Cebu City just because it mentions Cebu.
const OTHER_CITIES = [
    'Talisay',
    'Consolacion',
    'Liloan',
    'Cordova',
    'Minglanilla',
    'Naga',
    'Carcar',
    'Danao',
    'Toledo',
    'Compostela',
];

// Cebu City districts, plus recurring venues, that event locations name
// instead of the city itself ("enspace Cebu", "IT Park, Lahug")
const CEBU_CITY_AREAS =
    /\b(it park|lahug|banilad|business park|ayala|mabolo|gorordo|sudlon|talamban|guadalupe|fuente|maxilom|sambag|apas|kasambagan|busay|south road properties|enspace|latitude corporate center)\b/;

function matchCity(text: string | null | undefined): string | null {
    if (!text) return null;
    const t = text.toLowerCase();

    if (/\bmandaue\b/.test(t)) return 'Mandaue';
    if (/\blapu[\s-]*lapu\b|\bmactan\b/.test(t)) return 'Lapu-Lapu';
    for (const name of OTHER_CITIES) {
        if (new RegExp(`\\b${name.toLowerCase()}\\b`).test(t)) return name;
    }
    if (/\bcebu\s*city\b/.test(t) || CEBU_CITY_AREAS.test(t)) return 'Cebu City';

    // A bare "Cebu" can mean the city or the province, so it stays unknown
    return null;
}

// events.city holds plain names ("Cebu City", "Mandaue City") but also
// Facebook place objects stored as JSON ('{"name":"Cebu City","id":"…"}')
function cityName(raw: string | null): string | null {
    const value = raw?.trim();
    if (!value) return null;
    if (!value.startsWith('{')) return value;
    try {
        const parsed = JSON.parse(value) as { name?: unknown };
        return typeof parsed.name === 'string' ? parsed.name : null;
    } catch {
        return null;
    }
}

/**
 * One canonical city per event: the explicit city column when it names a
 * place, else the venue text for in-person/hybrid events. Online events keep
 * an explicit (editorial) city but are never guessed from their location.
 */
export function normalizeCity(event: Pick<EventSearchRow, 'city' | 'location' | 'format'>): string | null {
    const explicit = matchCity(cityName(event.city));
    if (explicit) return explicit;
    return event.format === 'online' ? null : matchCity(event.location);
}

function toUnixSeconds(iso: string | null): number {
    if (!iso) return 0;
    const ms = new Date(iso).getTime();
    return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0;
}

export function eventToSearchDoc(event: EventSearchRow): EventSearchDoc {
    const primaryOrganizer = (event.organizers ?? [])
        .filter((o) => o.accounts?.name)
        .sort((a, b) => a.position - b.position)[0];

    const tagNames = (event.event_tags ?? [])
        .map((row) => row.tags?.name)
        .filter((n): n is string => !!n);

    return {
        id: String(event.id),
        name: event.name ?? '',
        description: event.description ?? '',
        start_time: toUnixSeconds(event.start_time),
        end_time: event.end_time ? toUnixSeconds(event.end_time) : undefined,
        location: event.location ?? '',
        city: normalizeCity(event),
        organization: primaryOrganizer?.accounts?.name ?? '',
        is_free: event.is_free === true,
        is_online: event.format === 'online',
        tags: tagNames,
        slug: event.slug ?? null,
        cover_photo: event.cover_photo ?? null,
    };
}
