// Import one Eventbrite event page: scrape it, save its organizer, ingest it,
// store its cover and geocode it. The link importer (eventbrite-scraper) and the
// organizer sync (retrieve-and-sync-to-db-eventbrite-events) both use this, so a
// pasted link and a discovered date are saved the same way.
import {
    findOrCreateAccount,
    geocodeEventLocations,
    getEventsByIds,
    ingestEvents,
    storeCoverImages,
} from '@service/core/supabase/features/events/index.ts';
import type { Account } from '@service/core/supabase/shared/types.ts';
import { fetchEventbriteEvent, toIngestEvent } from './eventbriteutils.ts';
import { withCebuAnchor } from './event-place.ts';
import type { EventbriteAccountDetails, EventbriteEvent, ImportOptions, ImportOutcome } from './types.ts';

async function resolveOrganizer(event: EventbriteEvent): Promise<Account | null> {
    const details: EventbriteAccountDetails = {
        path: event.organizer.path,
        organizer_id: event.organizer.account_id,
    };
    const account = await findOrCreateAccount({
        account_id: event.organizer.account_id,
        name: event.organizer.name,
        type: 'eventbrite',
        kind: 'eventbrite_organizer',
        primary_photo: event.organizer.avatar,
        account_details: details as unknown as Record<string, string>,
    });
    if (!account) return null;
    // account_id is unique across platforms, and Eventbrite organizer ids are
    // numeric like Facebook page ids. Never attach events to another
    // platform's account on an id collision.
    if (account.type !== 'eventbrite') {
        console.error(
            `[eventbrite-import] organizer id ${event.organizer.account_id} matches a ${account.type} account — refusing to attach`,
        );
        return null;
    }
    return account;
}

/** Imports the event at `canonicalUrl` (`https://www.eventbrite.com/e/<id>`); see ImportOutcome for what can happen. */
export async function importEventbriteEvent(canonicalUrl: string, opts: ImportOptions = {}): Promise<ImportOutcome> {
    const page = await fetchEventbriteEvent(canonicalUrl);
    if (!page) return { kind: 'not_found' };
    if (page.kind === 'series_parent') return { kind: 'series_parent', seriesId: page.seriesId, name: page.name };

    const event = page.event;
    if (opts.check && !opts.check(event)) return { kind: 'skipped', reason: 'outside_rule' };
    console.log(
        `[eventbrite-import] scraped: ${event.name} (${event.eventbrite_id}) — organizer=${event.organizer.name} (${event.organizer.account_id})`,
    );

    const organizer = await resolveOrganizer(event);
    if (!organizer) return { kind: 'organizer_failed', organizer: event.organizer.name };

    const cebuBased = opts.accountIsCebuBased ?? organizer.is_cebu_based ?? false;
    const results = await ingestEvents([withCebuAnchor(toIngestEvent(event, organizer.account_id), cebuBased)]);
    const result = results[0];
    if (!result) throw new Error('Ingest returned no result');
    console.log(
        `[eventbrite-import] event_id=${result.event_id} new=${result.is_new_event} ` +
            `canonical=${result.became_canonical} score=${result.match_score ?? 'n/a'}`,
    );

    const eventRows = await getEventsByIds([result.event_id]);
    await storeCoverImages(eventRows);
    await geocodeEventLocations(eventRows);
    return { kind: 'imported', result };
}
