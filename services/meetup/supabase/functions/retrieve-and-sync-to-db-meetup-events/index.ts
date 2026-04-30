import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { Account, IngestEvent } from '@service/core/supabase/shared/types.ts';
import {
    findOrCreateAccount,
    geocodeEventLocations,
    getEventsByIds,
    ingestEvents,
    storeCoverImages,
} from '@service/core/supabase/features/events/index.ts';
import { fetchEventsForMeetupGroup } from '../_shared/meetuputils.ts';
import { MeetupAccountDetails, MeetupEvent } from '../_shared/types.ts';

async function buildIngestForMeetupEvent(event: MeetupEvent): Promise<IngestEvent | null> {
    // Meetup groups are 1:1 organizers — the group itself IS the presenter.
    // No co-host concept on Meetup; the platform models a single owning group
    // per event, so organizers always has length 1.
    const account = await findOrCreateAccount({
        account_id: event.group.urlname,
        name: event.group.name,
        type: 'meetup',
        kind: 'meetup_group',
        primary_photo: event.group.avatar,
    });
    if (!account) {
        console.warn(
            `[meetup-cron] event ${event.meetup_id} — could not persist group account ${event.group.urlname}`,
        );
        return null;
    }

    // Format derivation. Physical venue with coordinates = in_person; missing
    // venue or coords = online. Meetup hybrid events show a physical venue
    // and are tagged in_person (closest match) — losing the hybrid signal
    // is acceptable until we surface a hybrid filter chip.
    const format: 'in_person' | 'online' =
        event.venue && event.venue.lat != null && event.venue.lng != null
            ? 'in_person'
            : 'online';

    return {
        name: event.name,
        description: event.description,
        start_time: event.start_time,
        end_time: event.end_time,
        timezone: event.timezone,
        format,
        location: event.location,
        location_details: event.location_details,
        city: event.venue?.city ?? event.group.city ?? null,
        region: null,
        country: null,
        cover_photo: event.cover_photo,
        source: 'meetup',
        source_id: event.meetup_id,
        source_url: event.url,
        // HTML scrape via __NEXT_DATA__ + Apollo cache — public_scrape tier.
        // Reserved for partnership upgrade if Meetup ever exposes an API for us.
        ingest_kind: 'public_scrape',
        raw: event as unknown,
        organizers: [{ account_id: account.account_id, role: 'presenter' }],
    };
}

async function processGroup(account: Account) {
    const { account_id } = account;

    // v2: accounts.discovery_path holds the meetup group urlname.
    const a = account as Account & { discovery_path?: string | null };
    const path = a.discovery_path;

    const details = (account.account_details as MeetupAccountDetails | null) ?? {};

    if (!path) {
        console.warn(`[meetup-cron] account ${account_id} has no discovery_path — skipping`);
        return null;
    }

    console.log(
        `[meetup-cron] processing group "${path}" for account ${account_id}${details.label ? ` (${details.label})` : ''}`,
    );

    const events = await fetchEventsForMeetupGroup(path);
    console.log(`[meetup-cron] retrieved ${events.length} future event(s) from group ${path}`);

    const ingests: IngestEvent[] = [];
    for (const event of events) {
        const ingest = await buildIngestForMeetupEvent(event);
        if (ingest) ingests.push(ingest);
    }

    const results = await ingestEvents(ingests);
    console.log(
        `[meetup-cron] ingested ${results.length} for ${account_id}: ` +
            `${results.filter((r) => r.is_new_event).length} new, ` +
            `${results.filter((r) => !r.is_new_event).length} matched/re-scraped, ` +
            `${results.filter((r) => r.became_canonical).length} became canonical`,
    );

    const eventRows = await getEventsByIds(results.map((r) => r.event_id));
    await storeCoverImages(eventRows);
    await geocodeEventLocations(eventRows);

    return results;
}

Deno.serve(async (req) => {
    try {
        const account: Account = await req.json();

        // Await synchronously — same trade-off the Luma cron makes.
        // EdgeRuntime.waitUntil silently aborts when invoked from pg_net's
        // fan-out, so we block on the scrape+ingest. A busy group with 10
        // events takes ~15-25s (1.5s gap × per-event detail fetches);
        // acceptable for cron orchestration and gives clear status visibility.
        const results = await processGroup(account);
        const ingested = Array.isArray(results) ? results.length : 0;

        return new Response(
            JSON.stringify({
                message: `processed account ${account.account_id} (${ingested} event(s))`,
                account_id: account.account_id,
                ingested,
            }),
            { headers: { 'Content-Type': 'application/json' } },
        );
    } catch (error) {
        console.error('[meetup-cron] error processing group:', error);
        return new Response(
            JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
            { status: 500, headers: { 'Content-Type': 'application/json' } },
        );
    }
});
