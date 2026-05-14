import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { EventData } from 'npm:facebook-event-scraper';
import { findOrCreateAccount } from '@service/core/supabase/features/events/index.ts';
import { IngestEvent } from '@service/core/supabase/shared/types.ts';
import { FacebookEvent } from './types.ts';
import { hostsFromPublicScrape } from './organizers.ts';

/**
 * Convert a facebook-event-scraper `EventData` into our ingest shape. Shared
 * between the manual `fb-scraper` function and the no-token cron path so
 * both produce identical IngestEvent records.
 *
 * Returns null when the event has no usable hosts after filtering. Callers
 * decide whether to throw or just skip.
 *
 * Options:
 *   allowUserHosts — Watch-list path opt-in. False (default) keeps the v1
 *   "Pages only" policy used by manual fb-scraper. True lets through User-
 *   type hosts since the operator explicitly added that page to the watch
 *   list (User-profile communities like DOHEPhilippines would otherwise
 *   never ingest).
 */
export async function buildIngestFromFbEvent(
    event: EventData,
    opts?: { allowUserHosts?: boolean },
): Promise<IngestEvent | null> {
    const allowUserHosts = opts?.allowUserHosts === true;
    const allHosts = event.hosts ?? [];
    const eligible = hostsFromPublicScrape(event, { allowUserHosts });

    if (eligible.length === 0) {
        console.warn(
            `[fb-shared] event ${event.id} has no eligible hosts ` +
                `(${allHosts.length} total; allowUserHosts=${allowUserHosts}) — skipping`,
        );
        return null;
    }

    const organizers: Array<{ account_id: string; role?: string }> = [];
    for (const host of eligible) {
        const account = await findOrCreateAccount({
            account_id: String(host.id),
            name: host.name,
            type: 'facebook',
            // URL-derived: anything past the eligibility filter is treated
            // as a Page-like entity even when FB labels it 'User'. The
            // watch-list operator has opted into this.
            kind: 'fb_page',
            primary_photo: host.photoUrl ?? null,
        });
        if (account) {
            // Use the resolved account_id — may differ from host.id when
            // findOrCreateAccount deduped by name to an existing row (e.g.
            // the slug-keyed watch row).
            organizers.push({ account_id: String(account.account_id), role: 'presenter' });
        }
    }
    if (organizers.length === 0) {
        console.warn(`[fb-shared] event ${event.id} — no organizers could be persisted`);
        return null;
    }

    const startMs = (event.startTimestamp ?? 0) * 1000;
    const endMs = event.endTimestamp ? event.endTimestamp * 1000 : null;

    return {
        name: event.name ?? '(unnamed)',
        description: event.description ?? null,
        start_time: new Date(startMs).toISOString(),
        end_time: endMs ? new Date(endMs).toISOString() : null,
        timezone: (event as unknown as { timezone?: string }).timezone ?? null,
        format: (event.location?.coordinates?.latitude != null ? 'in_person' : 'online') as
            | 'in_person'
            | 'online',
        location: event.location?.name ?? null,
        location_details:
            event.location?.coordinates?.latitude != null &&
                event.location?.coordinates?.longitude != null
                ? {
                    latitude: event.location.coordinates.latitude,
                    longitude: event.location.coordinates.longitude,
                }
                : null,
        // facebook-event-scraper exposes city/country on event.location
        // depending on the page's HTML structure. Pull defensively — these
        // may be undefined for some events. Cast through unknown since the
        // lib's types vary.
        city: (event.location as unknown as { city?: string | null })?.city ?? null,
        country: (event.location as unknown as { country?: string | null })?.country ?? null,
        // event.photo.url is a /photo/?fbid=... page (HTML), not the image.
        // event.photo.imageUri is the actual CDN URL — prefer it.
        cover_photo: (event.photo as unknown as { imageUri?: string })?.imageUri
            ?? event.photo?.url
            ?? null,
        source: 'facebook',
        source_id: String(event.id),
        source_url: event.url ?? `https://www.facebook.com/events/${event.id}`,
        ingest_kind: 'public_scrape',
        raw: event as unknown,
        organizers,
        organizer_write_mode: 'replace',
    };
}

export async function retrieveEventsFromFacebook(url: string): Promise<FacebookEvent[]> {
    const allEvents = [];

    try {
        const response = await fetch(url, {
            method: 'GET',
        });
        const result = await response.json();
        allEvents.push(...result.data);

        if (result?.paging?.next) {
            const nextEvents = await retrieveEventsFromFacebook(result.paging.next);
            allEvents.push(...nextEvents);
        }
    } catch (error) {
        if (error instanceof Response) {
            // The request was made and the server responded with a status code
            // that falls out of the range of 2xx
            console.log(await error.json());
            console.log(error.status);
            console.log(error.headers);
        } else if (error instanceof Error) {
            // Something happened in setting up the request that triggered an Error
            console.log('Error', error.message);
        } else {
            console.log('Unknown error', error);
        }
    }

    return allEvents;
}
