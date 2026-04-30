import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { IngestEvent } from '@service/core/supabase/shared/types.ts';
import {
    findOrCreateAccount,
    geocodeEventLocations,
    getEventsByIds,
    ingestEvents,
    storeCoverImages,
} from '@service/core/supabase/features/events/index.ts';
import { fetchMeetupEvent } from '../_shared/meetuputils.ts';
import { MeetupEvent } from '../_shared/types.ts';

async function buildIngest(event: MeetupEvent): Promise<IngestEvent | null> {
    // Single-organizer per Meetup event — the group is the presenter.
    const account = await findOrCreateAccount({
        account_id: event.group.urlname,
        name: event.group.name,
        type: 'meetup',
        kind: 'meetup_group',
        primary_photo: event.group.avatar,
    });
    if (!account) {
        console.warn(`[meetup-scraper] event ${event.meetup_id} — could not persist group account`);
        return null;
    }

    const format: 'in_person' | 'online' =
        event.venue && event.venue.lat != null && event.venue.lng != null ? 'in_person' : 'online';

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
        ingest_kind: 'public_scrape',
        raw: event as unknown,
        organizers: [{ account_id: account.account_id, role: 'presenter' }],
    };
}

async function processEvent({ url }: { url: string }) {
    if (!url) throw new Error('URL is required');

    const event = await fetchMeetupEvent(url);
    if (!event) {
        console.warn(`[meetup-scraper] no event found at ${url}`);
        return null;
    }
    console.log(
        `[meetup-scraper] scraped: ${event.name} (${event.meetup_id}) — group=${event.group.name} (${event.group.urlname})`,
    );

    const ingest = await buildIngest(event);
    if (!ingest) return null;

    const results = await ingestEvents([ingest]);
    if (results.length === 0) {
        console.error('[meetup-scraper] ingest returned no result');
        return null;
    }
    const result = results[0];
    console.log(
        `[meetup-scraper] event_id=${result.event_id} new=${result.is_new_event} ` +
            `canonical=${result.became_canonical} score=${result.match_score ?? 'n/a'}`,
    );

    const eventRows = await getEventsByIds([result.event_id]);
    await storeCoverImages(eventRows);
    await geocodeEventLocations(eventRows);

    return result;
}

Deno.serve(async (req) => {
    if (req.method !== 'POST') {
        return new Response('Method not allowed', { status: 405 });
    }

    const { url } = await req.json();
    console.log('🚀 ~ Deno.serve ~ url:', url);

    // @ts-ignore-next-line
    EdgeRuntime.waitUntil(processEvent({ url }));

    return new Response(JSON.stringify({ message: 'Event processing queued' }), {
        headers: { 'Content-Type': 'application/json' },
    });
});
