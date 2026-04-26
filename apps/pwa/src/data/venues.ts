/**
 * Venue registry — hand-curated canonical venues for Cebu tech events.
 *
 * Why: event.location is free-text from various sources (Facebook, manual entry,
 * organizer descriptions), so the same venue appears under many spellings
 * ("enspace Cebu" / "enspace Cebu (Business Park)" / "enspace Cebu Business Park, 14th Floor…").
 * resolveVenue() collapses those into one canonical Venue so we can render
 * consistent chips, group by venue, and eventually render a map view.
 *
 * No DB migration: the registry is a pure code lookup. Promote to a `venues`
 * table later if/when this needs to be editable outside a deploy.
 */

export type Neighborhood =
    | 'Business Park'
    | 'IT Park'
    | 'Mandaue'
    | 'Lahug'
    | 'Cebu City'
    | 'Mactan'
    | 'Online';

export interface Venue {
    /** URL-safe canonical id, e.g. 'enspace'. Also used for /venues/[slug]. */
    slug: string;
    /** Display name shown in the chip. */
    name: string;
    /** Coarse area shown after the venue name and used for grouping. */
    neighborhood: Neighborhood;
    /**
     * Lowercased substrings that, when found in event.location, identify this venue.
     * Order matters — list more specific aliases first.
     */
    aliases: string[];
    /** Approximate coordinates. Omit when unknown; map view will skip the pin. */
    lat?: number;
    lng?: number;
}

export const VENUES: Venue[] = [
    {
        slug: 'enspace',
        name: 'enspace Cebu',
        neighborhood: 'Business Park',
        aliases: [
            'enspace cebu business park',
            'enspace cebu (business park)',
            'enspace cebu',
            'enspace',
        ],
        lat: 10.3175,
        lng: 123.905,
    },
    {
        slug: 'the-company-mandaue',
        name: 'The Company',
        neighborhood: 'Mandaue',
        aliases: [
            'the company cebu (mandaue)',
            'the company cebu mandaue',
            'the company mandaue (mandaue)',
            'the company mandaue',
        ],
        lat: 10.3392,
        lng: 123.9395,
    },
    {
        slug: 'mabuhay-tower-it-park',
        name: 'Mabuhay Tower',
        neighborhood: 'IT Park',
        aliases: ['mabuhay tower - cebu i.t. park', 'mabuhay tower'],
        lat: 10.3318,
        lng: 123.9077,
    },
    {
        slug: 'accenture-ebloc2',
        name: 'Accenture eBloc2',
        neighborhood: 'IT Park',
        aliases: ['accenture, ebloc2 it park', 'ebloc2', 'accenture ebloc2'],
        lat: 10.329,
        lng: 123.9067,
    },
    {
        slug: 'dost-cebu-psto',
        name: 'DOST Cebu PSTO',
        neighborhood: 'Lahug',
        aliases: ['dost cebu psto', 'dost region 7', 'dost region 7, sudlon, lahug'],
        lat: 10.358,
        lng: 123.893,
    },
    {
        slug: 'iec-convention-center',
        name: 'IEC Convention Center',
        neighborhood: 'Cebu City',
        aliases: ['iec convention center cebu city', 'iec convention center'],
        lat: 10.332,
        lng: 123.917,
    },
    {
        slug: 'one-montage',
        name: 'One Montage',
        neighborhood: 'Lahug',
        aliases: ['21f one montage', 'one montage'],
        lat: 10.33,
        lng: 123.91,
    },
    {
        slug: 'nest-workspaces',
        name: 'Nest Workspaces',
        neighborhood: 'Cebu City',
        aliases: ['nest workspaces'],
    },
    {
        slug: 'bos-coffee-filinvest',
        name: "Bo's Coffee Filinvest",
        neighborhood: 'IT Park',
        aliases: ["bo's coffee filinvest cyberzone", 'filinvest cyberzone'],
        lat: 10.329,
        lng: 123.905,
    },
    {
        slug: 'mezzo-hotel',
        name: 'Mezzo Hotel',
        neighborhood: 'Cebu City',
        aliases: ['mezzo hotel'],
        lat: 10.2989,
        lng: 123.8985,
    },
    {
        slug: 'quest-hotel',
        name: 'Quest Hotel',
        neighborhood: 'Lahug',
        aliases: ['quest hotel'],
        lat: 10.3273,
        lng: 123.91,
    },
    {
        slug: 'hotel-one',
        name: 'Hotel One',
        neighborhood: 'Cebu City',
        aliases: ['hotel one'],
        lat: 10.2995,
        lng: 123.9015,
    },
    {
        slug: 'lyf-cebu',
        name: 'lyf Cebu City',
        neighborhood: 'IT Park',
        aliases: ['lyf cebu city', 'lyf cebu'],
        lat: 10.331,
        lng: 123.907,
    },
    {
        slug: 'handuraw-pizza',
        name: 'Handuraw Pizza',
        neighborhood: 'Lahug',
        aliases: ['handuraw pizza', 'handuraw'],
        lat: 10.338,
        lng: 123.902,
    },
];

/** Normalize a free-text location for matching: lowercase, collapse whitespace. */
function normalize(input: string): string {
    return input.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Resolve a free-text event.location string to a canonical Venue, or null if
 * no alias matches. Matches by substring on the normalized form. Aliases within
 * a venue are tried in declaration order (more specific first).
 */
export function resolveVenue(rawLocation: string | null | undefined): Venue | null {
    if (!rawLocation) return null;
    const haystack = normalize(rawLocation);
    for (const venue of VENUES) {
        for (const alias of venue.aliases) {
            if (haystack.includes(alias)) return venue;
        }
    }
    return null;
}

/** Look up a venue by its canonical slug — for /venues/[slug] pages. */
export function getVenueBySlug(slug: string): Venue | null {
    return VENUES.find((v) => v.slug === slug) ?? null;
}
