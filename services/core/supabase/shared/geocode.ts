/**
 * Geocoding helper shared between the PWA's backfill script and the Supabase
 * edge functions that ingest events. Pure: takes an API key, returns coords or
 * a structured failure. No env access, no logging — caller decides.
 *
 * Both consumers run on platforms with native fetch + URLSearchParams (Node 22
 * for the backfill, Deno for the edge functions), so this file is dependency-free.
 */

/** Cebu bounding box. Geocoder garbage outside this gets rejected. */
export const CEBU_BOUNDS = {
    minLat: 9.0,
    maxLat: 11.5,
    minLng: 123.0,
    maxLng: 124.5,
} as const;

export function isPlausibleCebuCoord(lat: number, lng: number): boolean {
    return (
        Number.isFinite(lat) &&
        Number.isFinite(lng) &&
        lat >= CEBU_BOUNDS.minLat &&
        lat <= CEBU_BOUNDS.maxLat &&
        lng >= CEBU_BOUNDS.minLng &&
        lng <= CEBU_BOUNDS.maxLng
    );
}

export interface GeocodeOk {
    ok: true;
    lat: number;
    lng: number;
    formatted: string;
}
export interface GeocodeFail {
    ok: false;
    reason: string;
}
export type GeocodeResult = GeocodeOk | GeocodeFail;

/**
 * Detect "online event" strings that a free-text geocoder will mis-resolve to
 * a real but irrelevant coordinate. Caller should typically skip these without
 * spending an API call.
 */
export function looksLikeOnlineEvent(rawLocation: string): boolean {
    const normalized = rawLocation.replace(/\s/g, '').toLowerCase();
    if (normalized === 'online' || normalized === 'onlineevent') return true;
    return /^\s*online(\s+event)?\s*$/i.test(rawLocation);
}

async function geocodeOnce(
    address: string,
    googleMapsKey: string,
    rawLocation: string,
): Promise<GeocodeResult> {
    const params = new URLSearchParams({
        address,
        key: googleMapsKey,
        region: 'ph',
        components: 'country:PH|administrative_area:Cebu',
        // bounds biases Google's ranking towards results inside this rectangle,
        // which fixes false negatives like "Cebu Technological University" that
        // otherwise resolve to a same-named place outside Cebu.
        bounds: `${CEBU_BOUNDS.minLat},${CEBU_BOUNDS.minLng}|${CEBU_BOUNDS.maxLat},${CEBU_BOUNDS.maxLng}`,
    });

    const res = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?${params}`);
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };

    const body = (await res.json()) as {
        status: string;
        error_message?: string;
        results?: Array<{
            geometry: { location: { lat: number; lng: number } };
            formatted_address: string;
        }>;
    };

    if (body.status !== 'OK' || !body.results?.length) {
        return {
            ok: false,
            reason: `${body.status}${body.error_message ? `: ${body.error_message}` : ''}`,
        };
    }

    // Google returns multiple candidates ranked by relevance. The bounds param
    // biases ranking but doesn't filter — for ambiguous strings ("CTU", "DOST")
    // a non-Cebu match can still come back first.
    //
    // We can safely walk for a Cebu-bounds match only when the input string
    // *itself* asserts Cebu — otherwise a venue that's genuinely elsewhere
    // (e.g. "The Company MAKATI") would be silently relocated to a same-named
    // Cebu spot.
    const mentionsCebu = /\bcebu\b/i.test(rawLocation);
    const candidates = mentionsCebu ? body.results : body.results.slice(0, 1);

    for (const result of candidates) {
        const { lat, lng } = result.geometry.location;
        if (isPlausibleCebuCoord(lat, lng)) {
            return { ok: true, lat, lng, formatted: result.formatted_address };
        }
    }

    const first = body.results[0].geometry.location;
    return {
        ok: false,
        reason: `out_of_bounds (${first.lat.toFixed(3)}, ${first.lng.toFixed(3)})`,
    };
}

/**
 * Resolve a free-text location string to coordinates via the Google Geocoding
 * API, with a Philippines/Cebu region+bounds bias so generic strings like
 * "Cebu City" or "Cebu Technological University" don't drift to other regions.
 *
 * On out-of-bounds failure, retries once with "Cebu City, Philippines" appended
 * — this rescues queries like bare "CTU" where Google's first match is a
 * same-named place outside Cebu.
 *
 * Returns a structured result; success guarantees coords are inside CEBU_BOUNDS.
 */
export async function geocodeLocation(
    rawLocation: string,
    googleMapsKey: string,
): Promise<GeocodeResult> {
    const first = await geocodeOnce(rawLocation, googleMapsKey, rawLocation);
    if (first.ok) return first;

    // Retry with an explicit "Cebu City, Philippines" suffix only when the
    // input itself asserts Cebu. This rescues things like "Cebu Technological
    // University (CTU)" (Google's first match is a same-named place outside
    // Cebu) without silently relocating events that were honestly elsewhere
    // (e.g. "The Company MAKATI").
    if (!/\bcebu\b/i.test(rawLocation)) return first;

    const augmented = `${rawLocation}, Cebu City, Philippines`;
    return geocodeOnce(augmented, googleMapsKey, rawLocation);
}
