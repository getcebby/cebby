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

/**
 * Whether a physical place is in Cebu: Cebu City and its areas, Mandaue,
 * Lapu-Lapu, or another Cebu town. Towns whose names also exist elsewhere in
 * the Philippines (Naga, Talisay, Danao, Compostela…) count only when the place
 * also says Cebu, and a bare "Cebu" counts since both its meanings are in scope.
 */
export function isInCebu(place: PhysicalPlace): boolean {
    const country = place.country?.trim();
    if (country && !PHILIPPINES.test(country)) return false;

    const text = [place.city, place.region, place.address].filter(Boolean).join(', ');
    const mentionsCebu = /\bcebu\b/i.test(text);
    const town = matchCebuCity(text);
    if (town === null) return mentionsCebu;
    if (OTHER_CITIES.includes(town)) return mentionsCebu;
    return true;
}

/** Whether an event counts for Cebby, from where it happens and whether its account is Cebu-based. */
export function countsForCebby(place: EventPlace, accountIsCebuBased: boolean): boolean {
    if (place.online) return accountIsCebuBased;
    return isInCebu(place);
}
