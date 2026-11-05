// Where a scraped Eventbrite event happens, for the Cebu rule, and the Cebu
// tag on a Cebu-based organizer's online events. Pure, so it can be tested
// without the database (import-event.ts loads the Supabase client).
import type { EventPlace } from '@service/core/supabase/shared/cebu-rule.ts';
import type { IngestEvent } from '@service/core/supabase/shared/types.ts';
import type { EventbriteEvent } from './types.ts';

/** Luma's values for Cebu (production, 2026-11-05), so the city filter treats both the same. */
export const CEBU_ANCHOR = { city: 'Cebu City', region: 'Central Visayas', country: 'Philippines' } as const;

/** The event's place: online (the parser's `location: 'Online'`) or its venue. */
export function placeOfEventbriteEvent(event: EventbriteEvent): EventPlace {
    if (event.location === 'Online') return { online: true };
    const venue = event.venue;
    return {
        online: false,
        city: venue?.city ?? null,
        region: venue?.region ?? null,
        country: venue?.country ?? null,
        address: venue?.address ?? event.location ?? null,
    };
}

/** Tags a Cebu-based organizer's online event with Cebu, as Luma tags online events from a Cebu calendar. */
export function withCebuAnchor(ingest: IngestEvent, accountIsCebuBased: boolean): IngestEvent {
    if (!accountIsCebuBased || ingest.format !== 'online') return ingest;
    return { ...ingest, ...CEBU_ANCHOR };
}
