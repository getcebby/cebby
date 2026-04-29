import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { scrapeFbEvent, scrapeFbEventFromFbid, EventData } from 'facebook-event-scraper';
import {
    findOrCreateAccount,
    geocodeEventLocations,
    getEventsByIds,
    ingestEvents,
    storeCoverImages,
} from '@service/core/supabase/features/events/index.ts';
import { IngestEvent } from '@service/core/supabase/shared/types.ts';

function fbHostKind(hostType: string | undefined): string {
    return hostType === 'Page' ? 'fb_page' : 'fb_user';
}

async function buildIngestFromFbEvent(event: EventData): Promise<IngestEvent | null> {
    const allHosts = event.hosts ?? [];
    // Only Page-type hosts are organizing bodies (PizzaPy, JSCebu, AWSUG-style
    // communities). User-type hosts are individual people — visible via FB's
    // event page itself; not part of Cebby's organizational attribution.
    const orgHosts = allHosts.filter((h) => h.type === 'Page');
    if (orgHosts.length === 0) {
        console.warn(
            `[fb-scraper] event ${event.id} has no Page-type hosts ` +
                `(${allHosts.length} total host(s); individuals only) — skipping`,
        );
        return null;
    }

    // Find-or-create an accounts row for every Page-type host. New cohost
    // discoveries appear as bare account rows that an admin can later group
    // under an organization (and grant FB tokens to if you want them in the
    // cron sync).
    const organizers: Array<{ account_id: string; role?: string }> = [];
    for (const host of orgHosts) {
        const account = await findOrCreateAccount({
            account_id: String(host.id),
            name: host.name,
            type: 'facebook',
            kind: fbHostKind(host.type),
            primary_photo: host.photo?.url ?? null,
        });
        if (account) {
            // Use the resolved account_id (may differ from host.id when
            // findOrCreateAccount deduped by name to an existing row).
            organizers.push({ account_id: String(account.account_id), role: 'presenter' });
        }
    }
    if (organizers.length === 0) {
        console.warn(`[fb-scraper] event ${event.id} — no organizers could be persisted`);
        return null;
    }

    const startMs = (event.startTimestamp ?? 0) * 1000;
    const endMs = event.endTimestamp ? event.endTimestamp * 1000 : null;

    return {
        name: event.name ?? '(unnamed)',
        description: event.description ?? null,
        start_time: new Date(startMs).toISOString(),
        end_time: endMs ? new Date(endMs).toISOString() : null,
        location: event.location?.name ?? null,
        location_details:
            event.location?.coordinates?.latitude != null &&
            event.location?.coordinates?.longitude != null
                ? {
                      latitude: event.location.coordinates.latitude,
                      longitude: event.location.coordinates.longitude,
                  }
                : null,
        cover_photo: event.photo?.url ?? null,
        source: 'facebook',
        source_id: String(event.id),
        source_url: event.url ?? `https://www.facebook.com/events/${event.id}`,
        raw: event as unknown,
        organizers,
    };
}

async function processEvent({ url, id }: { url: string; id: string }) {
    if (!url && !id) {
        throw new Error('URL and ID are required');
    }

    let event: EventData;
    try {
        event = id ? await scrapeFbEventFromFbid(id) : await scrapeFbEvent(url);
        console.log(`[fb-scraper] scraped: ${event.name} (${event.id}) — ${event.hosts?.length ?? 0} host(s)`);
    } catch (err) {
        console.error('[fb-scraper] scrape failed:', err instanceof Error ? err.message : err);
        return null;
    }

    const ingest = await buildIngestFromFbEvent(event);
    if (!ingest) return null;

    const results = await ingestEvents([ingest]);
    if (results.length === 0) {
        console.error('[fb-scraper] ingest returned no result');
        return null;
    }
    const result = results[0];
    console.log(
        `[fb-scraper] event_id=${result.event_id} new=${result.is_new_event} ` +
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

    const { url, id } = await req.json();
    console.log('🚀 ~ Deno.serve ~ url, id:', url, id);

    // @ts-ignore-next-line
    EdgeRuntime.waitUntil(processEvent({ url, id }));

    return new Response(JSON.stringify({ message: 'Event processing queued' }), {
        headers: { 'Content-Type': 'application/json' },
    });
});
