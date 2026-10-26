type JsonObject = Record<string, unknown>;

export interface SourceLinkForContent {
    id: number;
    event_id: number;
    source: string;
    source_id: string;
    url: string | null;
    ingest_kind?: string | null;
    scraped_at?: string | null;
    raw?: unknown;
}

export interface EventContentSnapshot {
    name: string | null;
    description: string | null;
    start_time: string | null;
    end_time: string | null;
    timezone: string | null;
    location: string | null;
    location_details: { latitude: number; longitude: number } | null;
    cover_photo: string | null;
    city: string | null;
    region: string | null;
    country: string | null;
}

export interface EventRowForContent extends EventContentSnapshot {
    id: number;
    primary_source_link_id?: number | null;
}

const CONTENT_FIELDS = [
    'name',
    'description',
    'start_time',
    'end_time',
    'timezone',
    'location',
    'location_details',
    'cover_photo',
    'city',
    'region',
    'country',
] as const;

function asObject(value: unknown): JsonObject | null {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as JsonObject
        : null;
}

function asString(value: unknown): string | null | undefined {
    if (value === undefined) return undefined;
    if (value === null) return null;
    if (typeof value !== 'string') return undefined;
    return value.trim().length > 0 ? value : null;
}

function readPath(root: unknown, path: string[]): unknown {
    let current: unknown = root;
    for (const segment of path) {
        const object = asObject(current);
        if (!object || !(segment in object)) return undefined;
        current = object[segment];
    }
    return current;
}

function firstString(root: unknown, paths: string[][]): string | null | undefined {
    for (const path of paths) {
        const value = asString(readPath(root, path));
        if (value !== undefined) return value;
    }
    return undefined;
}

function readNumber(root: unknown, paths: string[][]): number | null | undefined {
    for (const path of paths) {
        const value = readPath(root, path);
        if (value === undefined) continue;
        if (value === null) return null;
        if (typeof value === 'number' && Number.isFinite(value)) return value;
        if (typeof value === 'string' && value.trim()) {
            const parsed = Number(value);
            if (Number.isFinite(parsed)) return parsed;
        }
    }
    return undefined;
}

/** String date fields first; then epoch-second fields, which the Facebook
 * public scraper stores as `startTimestamp`/`endTimestamp`. Mirrors the ingest
 * conversion, where a falsy end timestamp means no end time. */
function readDate(root: unknown, stringPaths: string[][], epochSecondPaths: string[][]): string | null | undefined {
    const text = firstString(root, stringPaths);
    if (text !== undefined) return text;

    const seconds = readNumber(root, epochSecondPaths);
    if (seconds === undefined) return undefined;
    return seconds ? new Date(seconds * 1000).toISOString() : null;
}

function readLocationDetails(root: unknown): { latitude: number; longitude: number } | null | undefined {
    const direct = readPath(root, ['location_details']);
    const directObject = asObject(direct);
    if (directObject) {
        const latitude = readNumber(directObject, [['latitude'], ['lat']]);
        const longitude = readNumber(directObject, [['longitude'], ['lng'], ['lon']]);
        if (latitude == null || longitude == null) return latitude === null || longitude === null ? null : undefined;
        return { latitude, longitude };
    }

    const latitude = readNumber(root, [
        ['geo_address_info', 'latitude'],
        ['place', 'location', 'latitude'],
        ['location', 'coordinates', 'latitude'],
        ['location', 'latitude'],
        ['venue', 'lat'],
    ]);
    const longitude = readNumber(root, [
        ['geo_address_info', 'longitude'],
        ['place', 'location', 'longitude'],
        ['location', 'coordinates', 'longitude'],
        ['location', 'longitude'],
        ['venue', 'lng'],
    ]);

    if (latitude === undefined && longitude === undefined) return undefined;
    if (latitude == null || longitude == null) return null;
    return { latitude, longitude };
}

function readLocation(root: unknown): string | null | undefined {
    const direct = asString(readPath(root, ['location']));
    if (direct !== undefined) return direct;

    const locationObject = asObject(readPath(root, ['location']));
    if (locationObject) {
        const name = firstString(locationObject, [['name'], ['address']]);
        if (name !== undefined) return name;
    }

    const venueName = firstString(root, [['venue', 'name'], ['place', 'name']]);
    if (venueName !== undefined) return venueName;

    const venue = asObject(readPath(root, ['venue']));
    if (venue) {
        const name = asString(venue.name);
        const address = asString(venue.address);
        if (name || address) return [name, address].filter(Boolean).join(', ');
    }

    return undefined;
}

function readSnapshotFromRaw(raw: unknown): Partial<EventContentSnapshot> {
    if (!asObject(raw)) return {};

    return {
        name: firstString(raw, [['name'], ['title']]),
        description: firstString(raw, [['description'], ['details']]),
        start_time: readDate(
            raw,
            [['start_time'], ['start_at'], ['startAt'], ['startTime'], ['dateTime']],
            [['startTimestamp']],
        ),
        end_time: readDate(raw, [['end_time'], ['end_at'], ['endAt'], ['endTime']], [['endTimestamp']]),
        timezone: firstString(raw, [['timezone'], ['time_zone']]),
        location: readLocation(raw),
        location_details: readLocationDetails(raw),
        cover_photo: firstString(raw, [
            ['cover_photo'],
            ['cover_url'],
            ['cover', 'source'],
            ['photo', 'imageUri'],
            ['photo', 'url'],
            ['image', 'url'],
        ]),
        city: firstString(raw, [
            ['city'],
            ['geo_address_info', 'city'],
            ['place', 'location', 'city'],
            ['location', 'city'],
            ['venue', 'city'],
            ['group', 'city'],
        ]),
        region: firstString(raw, [
            ['region'],
            ['geo_address_info', 'region'],
            ['place', 'location', 'region'],
            ['location', 'region'],
        ]),
        country: firstString(raw, [
            ['country'],
            ['geo_address_info', 'country'],
            ['place', 'location', 'country'],
            ['location', 'country'],
        ]),
    };
}

export function compactEventState(event: Partial<EventRowForContent> | null | undefined): Partial<EventContentSnapshot> {
    const snapshot: Partial<EventContentSnapshot> = {};
    if (!event) return snapshot;

    for (const field of CONTENT_FIELDS) {
        if (field in event) snapshot[field] = event[field] as never;
    }
    return snapshot;
}

export function getSourceContentSnapshot(
    link: SourceLinkForContent,
    fallback?: Partial<EventRowForContent> | null,
): EventContentSnapshot {
    const rawSnapshot = readSnapshotFromRaw(link.raw);

    return {
        name: rawSnapshot.name !== undefined ? rawSnapshot.name : fallback?.name ?? null,
        description: rawSnapshot.description !== undefined ? rawSnapshot.description : fallback?.description ?? null,
        start_time: rawSnapshot.start_time !== undefined ? rawSnapshot.start_time : fallback?.start_time ?? null,
        end_time: rawSnapshot.end_time !== undefined ? rawSnapshot.end_time : fallback?.end_time ?? null,
        timezone: rawSnapshot.timezone !== undefined ? rawSnapshot.timezone : fallback?.timezone ?? null,
        location: rawSnapshot.location !== undefined ? rawSnapshot.location : fallback?.location ?? null,
        location_details: rawSnapshot.location_details !== undefined
            ? rawSnapshot.location_details
            : fallback?.location_details ?? null,
        cover_photo: rawSnapshot.cover_photo !== undefined ? rawSnapshot.cover_photo : fallback?.cover_photo ?? null,
        city: rawSnapshot.city !== undefined ? rawSnapshot.city : fallback?.city ?? null,
        region: rawSnapshot.region !== undefined ? rawSnapshot.region : fallback?.region ?? null,
        country: rawSnapshot.country !== undefined ? rawSnapshot.country : fallback?.country ?? null,
    };
}

export function deriveCanonicalEventUpdate(
    link: SourceLinkForContent,
    currentEvent: Partial<EventRowForContent>,
): Record<string, unknown> {
    const snapshot = getSourceContentSnapshot(link, currentEvent);
    const update: Record<string, unknown> = {
        primary_source_link_id: link.id,
    };

    for (const field of CONTENT_FIELDS) {
        update[field] = snapshot[field];
    }

    return update;
}
