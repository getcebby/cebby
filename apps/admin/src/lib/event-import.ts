export interface EventDraft {
    sourceUrl: string;
    sourceId: string;
    name: string;
    description: string;
    startTime: string;
    endTime: string | null;
    timezone: string;
    location: string;
    coverPhoto: string;
    organizerName: string;
    format: 'in_person' | 'online' | 'hybrid';
    raw: Record<string, unknown>;
    warnings: string[];
}

type JsonObject = Record<string, unknown>;

const DEFAULT_TIMEZONE = 'Asia/Manila';

export function emptyEventDraft(): EventDraft {
    return {
        sourceUrl: '',
        sourceId: '',
        name: '',
        description: '',
        startTime: '',
        endTime: null,
        timezone: DEFAULT_TIMEZONE,
        location: '',
        coverPhoto: '',
        organizerName: '',
        format: 'in_person',
        raw: {},
        warnings: [],
    };
}

export async function fetchEventDraftFromUrl(rawUrl: string): Promise<{ draft?: EventDraft; error?: string }> {
    let url: URL;
    try {
        url = new URL(rawUrl);
    } catch {
        return { error: 'Enter a valid event URL.' };
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        return { error: 'Event URL must be http or https.' };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    let html = '';
    let finalUrl = url.href;
    try {
        const response = await fetch(url.href, {
            headers: {
                Accept: 'text/html,application/xhtml+xml',
                'User-Agent': 'Mozilla/5.0 (compatible; CebbyAdmin/1.0)',
            },
            signal: controller.signal,
        });
        finalUrl = response.url || url.href;
        if (!response.ok) {
            return { error: `Could not fetch URL: HTTP ${response.status}` };
        }
        html = await response.text();
    } catch (err) {
        const reason = err instanceof Error
            ? (err.name === 'AbortError' ? 'request timed out after 15s' : err.message)
            : String(err);
        return { error: `Could not fetch URL: ${reason}` };
    } finally {
        clearTimeout(timeout);
    }

    const meta = extractMeta(html);
    const canonicalUrl = normalizeEventSourceId(
        meta.canonicalUrl || meta.ogUrl || finalUrl || url.href,
    );
    const jsonLdEvent = findJsonLdEvent(html);

    const name = textFrom(jsonLdEvent?.name)
        || cleanTitle(meta.ogTitle || meta.twitterTitle || meta.title || '');
    const description = stripTags(
        textFrom(jsonLdEvent?.description)
            || meta.ogDescription
            || meta.twitterDescription
            || meta.description
            || '',
    );
    const startTime = normalizeIso(textFrom(jsonLdEvent?.startDate) || meta.eventStartTime || '');
    const endTime = normalizeIso(textFrom(jsonLdEvent?.endDate) || meta.eventEndTime || '') || null;
    const location = locationFrom(jsonLdEvent?.location) || locationFromMeta(meta.twitterData1);
    const coverPhoto = imageFrom(jsonLdEvent?.image) || meta.ogImage || meta.twitterImage || '';

    const inferredOrganizer = inferOrganizerName(meta.description || meta.title || meta.ogTitle || '');
    const jsonOrganizer = organizerFrom(jsonLdEvent?.organizer);
    const organizerName = jsonOrganizer === 'Google Developer Groups' && inferredOrganizer
        ? inferredOrganizer
        : (jsonOrganizer || inferredOrganizer);

    const draft = emptyEventDraft();
    draft.sourceUrl = canonicalUrl;
    draft.sourceId = canonicalUrl;
    draft.name = name;
    draft.description = description;
    draft.startTime = startTime;
    draft.endTime = endTime;
    draft.location = stripTags(location);
    draft.coverPhoto = coverPhoto;
    draft.organizerName = organizerName;
    draft.format = inferFormat(jsonLdEvent?.eventAttendanceMode, draft.location);
    draft.raw = {
        source_url: canonicalUrl,
        fetched_url: finalUrl,
        fetched_at: new Date().toISOString(),
        json_ld_event: jsonLdEvent ?? null,
        meta,
    };
    draft.warnings = buildWarnings(draft, Boolean(jsonLdEvent));

    return { draft };
}

export function normalizeEventSourceId(rawUrl: string): string {
    try {
        const url = new URL(rawUrl);
        url.hash = '';
        url.search = '';
        url.hostname = url.hostname.toLowerCase();
        if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/+$/, '');
        return url.href;
    } catch {
        return rawUrl.trim();
    }
}

export function datetimeLocalToIso(value: string, timezone: string): string | null {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const withSeconds = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(trimmed)
        ? `${trimmed}:00`
        : trimmed;
    if (/[zZ]$|[+-]\d{2}:\d{2}$/.test(withSeconds)) {
        const parsed = new Date(withSeconds);
        return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
    }
    const offset = timezone === 'UTC' ? '+00:00' : '+08:00';
    const parsed = new Date(`${withSeconds}${offset}`);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function isoToDatetimeLocal(iso: string | null | undefined, timezone = DEFAULT_TIMEZONE): string {
    if (!iso) return '';
    const parsed = new Date(iso);
    if (Number.isNaN(parsed.getTime())) return '';

    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone || DEFAULT_TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
    });
    const parts = Object.fromEntries(
        formatter.formatToParts(parsed)
            .filter((part) => part.type !== 'literal')
            .map((part) => [part.type, part.value]),
    );
    if (!parts.year || !parts.month || !parts.day || !parts.hour || !parts.minute) return '';
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function normalizeIso(value: string): string {
    if (!value) return '';
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
}

function buildWarnings(draft: EventDraft, hasJsonLd: boolean): string[] {
    const warnings: string[] = [];
    if (!hasJsonLd) warnings.push('No schema.org Event JSON-LD found; fields came from meta tags.');
    if (!draft.name) warnings.push('Missing title.');
    if (!draft.startTime) warnings.push('Missing start time.');
    if (!draft.location) warnings.push('Missing location.');
    if (!draft.organizerName) warnings.push('Missing organizer name.');
    return warnings;
}

function extractMeta(html: string): Record<string, string> {
    const meta: Record<string, string> = {};
    const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
    if (title) meta.title = decodeHtmlEntities(stripTags(title)).trim();

    for (const tag of html.matchAll(/<meta\b[^>]*>/gi)) {
        const attrs = parseAttrs(tag[0]);
        const key = (attrs.property || attrs.name || '').toLowerCase();
        const content = decodeHtmlEntities(attrs.content || attrs.value || '').trim();
        if (!key || !content) continue;

        if (key === 'description') meta.description = content;
        if (key === 'og:title') meta.ogTitle = content;
        if (key === 'og:description') meta.ogDescription = content;
        if (key === 'og:image') meta.ogImage = content;
        if (key === 'og:url') meta.ogUrl = content;
        if (key === 'twitter:title') meta.twitterTitle = content;
        if (key === 'twitter:description') meta.twitterDescription = content;
        if (key === 'twitter:image') meta.twitterImage = content;
        if (key === 'twitter:data1') meta.twitterData1 = content;
        if (key === 'event:start_time') meta.eventStartTime = content;
        if (key === 'event:end_time') meta.eventEndTime = content;
    }

    for (const tag of html.matchAll(/<link\b[^>]*>/gi)) {
        const attrs = parseAttrs(tag[0]);
        if ((attrs.rel || '').toLowerCase() === 'canonical' && attrs.href) {
            meta.canonicalUrl = decodeHtmlEntities(attrs.href).trim();
        }
    }

    return meta;
}

function parseAttrs(tag: string): Record<string, string> {
    const attrs: Record<string, string> = {};
    for (const match of tag.matchAll(/([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
        attrs[match[1].toLowerCase()] = match[3] ?? match[4] ?? match[5] ?? '';
    }
    return attrs;
}

function findJsonLdEvent(html: string): JsonObject | null {
    for (const match of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
        const raw = decodeHtmlEntities(match[1].trim());
        if (!raw) continue;
        try {
            const parsed = JSON.parse(raw) as unknown;
            const event = findEventNode(parsed);
            if (event) return event;
        } catch {
            continue;
        }
    }
    return null;
}

function findEventNode(value: unknown): JsonObject | null {
    if (Array.isArray(value)) {
        for (const item of value) {
            const found = findEventNode(item);
            if (found) return found;
        }
        return null;
    }
    if (!isObject(value)) return null;
    if (hasType(value, 'Event')) return value;

    const graph = value['@graph'];
    if (graph) {
        const found = findEventNode(graph);
        if (found) return found;
    }

    for (const child of Object.values(value)) {
        if (child && typeof child === 'object') {
            const found = findEventNode(child);
            if (found) return found;
        }
    }
    return null;
}

function hasType(value: JsonObject, expected: string): boolean {
    const type = value['@type'];
    if (Array.isArray(type)) return type.some((item) => item === expected);
    return type === expected;
}

function locationFrom(value: unknown): string {
    if (!value) return '';
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return locationFrom(value[0]);
    if (!isObject(value)) return '';

    const name = textFrom(value.name);
    const address = value.address;
    if (typeof address === 'string') return [name, address].filter(Boolean).join(', ');
    if (isObject(address)) {
        const parts = [
            textFrom(address.streetAddress),
            textFrom(address.addressLocality),
            textFrom(address.postalCode),
        ].filter(Boolean);
        return [name, ...parts].filter(Boolean).join(', ');
    }
    return name;
}

function locationFromMeta(value: string | undefined): string {
    if (!value) return '';
    return value.replace(/^In-person Event\s*-\s*/i, '').trim();
}

function organizerFrom(value: unknown): string {
    if (!value) return '';
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return organizerFrom(value[0]);
    if (!isObject(value)) return '';
    return textFrom(value.name);
}

function imageFrom(value: unknown): string {
    if (!value) return '';
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return imageFrom(value[0]);
    if (!isObject(value)) return '';
    return textFrom(value.url);
}

function inferFormat(mode: unknown, location: string): EventDraft['format'] {
    const rawMode = textFrom(mode).toLowerCase();
    const rawLocation = location.toLowerCase();
    if (rawMode.includes('online') || rawLocation.startsWith('online')) return 'online';
    if (rawMode.includes('mixed') || rawMode.includes('hybrid')) return 'hybrid';
    return 'in_person';
}

function inferOrganizerName(text: string): string {
    const clean = decodeHtmlEntities(stripTags(text)).trim();
    const presents = clean.match(/(?:Google Developer Groups\s+)?(.+?)\s+presents\s+/i);
    if (presents?.[1]) return presents[1].trim();
    return '';
}

function cleanTitle(title: string): string {
    return decodeHtmlEntities(title)
        .replace(/\s*\|\s*Google Developer Groups\s*$/i, '')
        .replace(/^See\s+/i, '')
        .trim();
}

function stripTags(value: string): string {
    return value.replace(/<[^>]*>/g, '').replace(/\s+\n/g, '\n').trim();
}

function decodeHtmlEntities(value: string): string {
    return value
        .replace(/&quot;/g, '"')
        .replace(/&#x27;/g, "'")
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');
}

function textFrom(value: unknown): string {
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number') return String(value);
    return '';
}

function isObject(value: unknown): value is JsonObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
