import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import {
    findOrCreateAccount,
    geocodeEventLocations,
    getEventsByIds,
    ingestEvents,
    storeCoverImages,
} from '@service/core/supabase/features/events/index.ts';
import { IngestEvent } from '@service/core/supabase/shared/types.ts';
import { fetchLumaEvent } from '../_shared/lumautils.ts';
import { LumaEvent } from '../_shared/types.ts';

async function buildIngest(event: LumaEvent): Promise<IngestEvent | null> {
    // Cebby attributes events to organizing bodies, not to individual hosts.
    // For Luma that means data.calendar (the "Presented by" entity) — singular.
    // Individual hosts ("Hosted by") stay in raw payload only; users can see
    // them via the deep-link to Luma.
    const presenter = event.presenter;
    if (!presenter) {
        console.warn(`[luma-scraper] event ${event.api_id} has no presenter — skipping`);
        return null;
    }

    const account = await findOrCreateAccount({
        account_id: presenter.api_id,
        name: presenter.name,
        type: 'luma',
        kind: presenter.kind,
        primary_photo: presenter.avatar,
    });
    if (!account) {
        console.warn(`[luma-scraper] event ${event.api_id} — could not persist presenter account`);
        return null;
    }

    const format: 'in_person' | 'online' = event.location_type && event.location_type !== 'offline'
        ? 'online'
        : 'in_person';

    return {
        name: event.name,
        description: event.description,
        start_time: event.start_time,
        end_time: event.end_time,
        timezone: event.timezone,
        format,
        location: event.location,
        location_details: event.location_details,
        city: event.city,
        region: event.region,
        country: event.country,
        cover_photo: event.cover_photo,
        source: 'luma',
        source_id: event.api_id,
        source_url: event.url,
        ingest_kind: 'public_scrape',
        raw: event as unknown,
        organizers: [{ account_id: presenter.api_id, role: 'presenter' }],
    };
}

async function processEvent({ url }: { url: string }) {
    if (!url) {
        throw new Error('URL is required');
    }

    const event = await fetchLumaEvent(url);
    if (!event) {
        console.warn(`[luma-scraper] no event found at ${url}`);
        return null;
    }
    console.log(
        `[luma-scraper] scraped: ${event.name} (${event.api_id}) — ` +
            `presenter=${event.presenter?.name ?? '(none)'} hosts=${event.hosts.length}`,
    );

    const ingest = await buildIngest(event);
    if (!ingest) return null;

    const results = await ingestEvents([ingest]);
    if (results.length === 0) {
        console.error('[luma-scraper] ingest returned no result');
        return null;
    }
    const result = results[0];
    console.log(
        `[luma-scraper] event_id=${result.event_id} new=${result.is_new_event} ` +
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
