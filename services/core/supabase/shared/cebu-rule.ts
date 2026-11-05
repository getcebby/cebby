// What counts as a Cebby event, by where it happens (spec
// docs/superpowers/specs/2026-11-05-eventbrite-finding-design.md, Decisions 2):
//
//   the event is…            Cebu-based account   any other account
//   in person, in Cebu       counts               counts
//   online                   counts               doesn't
//   in person, elsewhere     doesn't              doesn't
//
// Pure functions only: every platform's import can call them, and search-doc
// uses the same town matcher for the city facet.

/** Where a physical event is, as the source describes it. Any field may be missing. */
export interface PhysicalPlace {
    city: string | null;
    region: string | null;
    country: string | null;
    /** The source's one-line address, when it has one. */
    address: string | null;
}

export type EventPlace = { online: true } | ({ online: false } & PhysicalPlace);

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

/** The Cebu city or town a piece of text names, or null. A bare "Cebu" stays null. */
export function matchCebuCity(text: string | null | undefined): string | null {
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

const PHILIPPINES = /^(ph|philippines)$/i;

// Cebu City area names that Metro Manila has too (Ayala Avenue and Guadalupe
// in Makati, any "business park"): alone they don't place an event in Cebu.
const SHARED_AREA_NAMES = /\b(ayala|business park|guadalupe)\b/gi;

const saysCebu = (text: string) => /\bcebu\b/i.test(text);

// Cebu province's postal codes (6000-6053). Eventbrite's region is the
// administrative region (Central Visayas, which Bohol shares), so a town like
// Talisay is placed by its postal code instead.
const CEBU_POSTAL_CODE = /\b60(?:[0-4]\d|5[0-3])\b/;

/**
 * Whether a physical place is in Cebu: Cebu City and its areas, Mandaue,
 * Lapu-Lapu, or another Cebu town.
 * - A place that names its city is judged by that city, so "Makati City" stays
 *   out whatever its address says.
 * - Towns whose names also exist elsewhere in the Philippines (Naga, Talisay,
 *   Danao, Compostela…) count only when the place also says Cebu or carries a
 *   Cebu postal code.
 * - A bare "Cebu" counts, since both its meanings (city, province) are in scope.
 */
export function isInCebu(place: PhysicalPlace): boolean {
    const country = place.country?.trim();
    if (country && !PHILIPPINES.test(country)) return false;

    const everything = [place.city, place.region, place.address].filter(Boolean).join(', ');
    const mentionsCebu = saysCebu(everything);
    const city = place.city?.trim();
    const text = city || [place.region, place.address].filter(Boolean).join(', ');
    const town = matchCebuCity(text);
    if (town === null) return city ? saysCebu(city) : mentionsCebu;
    if (OTHER_CITIES.includes(town)) return mentionsCebu || CEBU_POSTAL_CODE.test(everything);
    if (town === 'Cebu City' && !saysCebu(text)) {
        // Matched only by an area name: one that Metro Manila shares isn't enough.
        return matchCebuCity(text.replace(SHARED_AREA_NAMES, ' ')) === 'Cebu City';
    }
    return true;
}

/** Whether an event counts for Cebby, from where it happens and whether its account is Cebu-based. */
export function countsForCebby(place: EventPlace, accountIsCebuBased: boolean): boolean {
    if (place.online) return accountIsCebuBased;
    return isInCebu(place);
}
