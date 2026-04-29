import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { supabase } from '@service/core/supabase/shared/client.ts';
import { Account, IngestEvent } from '@service/core/supabase/shared/types.ts';
import {
    findOrCreateAccount,
    geocodeEventLocations,
    getEventsByIds,
    ingestEvents,
    storeCoverImages,
} from '@service/core/supabase/features/events/index.ts';
import { retrieveEventsFromFacebook } from '../_shared/events.ts';
import { FacebookCohost, FacebookEvent } from '../_shared/types.ts';

function extractCohosts(event: FacebookEvent): FacebookCohost[] {
    if (!event.cohosts) return [];
    if (Array.isArray(event.cohosts)) return event.cohosts;
    return Array.isArray(event.cohosts.data) ? event.cohosts.data : [];
}

/** v2: tokens live on account_secrets, not on accounts. */
async function fetchAccountTokens(
    accountId: string,
): Promise<{ access_token: string | null; page_access_token: string | null } | null> {
    const { data, error } = await supabase
        .from('account_secrets')
        .select('access_token, page_access_token')
        .eq('account_id', accountId)
        .maybeSingle();
    if (error) {
        console.error(`[fb-cron] account_secrets read failed for ${accountId}: ${error.message}`);
        return null;
    }
    return data as { access_token: string | null; page_access_token: string | null } | null;
}

async function processEvents(account: Account) {
    const { account_id } = account;

    console.log(`[fb-cron] processing events for account: ${account_id}`);

    const tokens = await fetchAccountTokens(account_id);
    const token = tokens?.page_access_token ?? tokens?.access_token;
    if (!token) {
        console.warn(
            `[fb-cron] account ${account_id} has no token in account_secrets — ` +
                `route via fb-scraper (no-token strategy) or grant a token in admin`,
        );
        return null;
    }

    const pageId = account_id;
    // place{...} expands location sub-fields so we get city/region/country/coords.
    // timezone gives us the named zone for display (events.timezone).
    // cohosts surfaces multi-org joint events at cron time.
    const fields =
        'id,name,cover,description,created_time,timezone,start_time,end_time,' +
        'place{name,location{city,region,country,country_code,latitude,longitude}},' +
        'cohosts';
    const url = `https://graph.facebook.com/v21.0/${pageId}/events?fields=${fields}&access_token=${token}&format=json&method=get`;

    const events = await retrieveEventsFromFacebook(url);
    console.log(`[fb-cron] retrieved ${events.length} events for account: ${account_id}`);

    const ingests = await mapEventsToIngest(events, account);
    const results = await ingestEvents(ingests);
    console.log(
        `[fb-cron] ingested ${results.length} for ${account_id}: ` +
            `${results.filter((r) => r.is_new_event).length} new, ` +
            `${results.filter((r) => !r.is_new_event).length} matched/re-scraped, ` +
            `${results.filter((r) => r.became_canonical).length} became canonical`,
    );

    // Fire-and-forget enrichment — failures here do not block the ingest response.
    const eventRows = await getEventsByIds(results.map((r) => r.event_id));
    await storeCoverImages(eventRows);
    await geocodeEventLocations(eventRows);

    return results;
}

Deno.serve(async (req) => {
    try {
        const account: Account = await req.json();

        // Synchronous — see retrieve-and-sync-to-db-luma-events for rationale.
        const results = await processEvents(account);
        const ingested = Array.isArray(results) ? results.length : 0;

        return new Response(
            JSON.stringify({
                message: `processed account ${account.account_id} (${ingested} event(s))`,
                account_id: account.account_id,
                ingested,
            }),
            {
                headers: { 'Content-Type': 'application/json' },
            },
        );
    } catch (error) {
        console.error('[fb-cron] error processing events:', error);
        return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
});

async function mapEventsToIngest(events: FacebookEvent[], account: Account): Promise<IngestEvent[]> {
    const ownerId = String(account.account_id);
    const ingests: IngestEvent[] = [];

    for (const event of events) {
        // Owning page is always the primary organizer. Cohosts (Page-type
        // entities the event creator added) become co-presenters. Find-or-
        // create each so we satisfy the FK from event_organizers.account_id.
        const organizers: Array<{ account_id: string; role?: string }> = [
            { account_id: ownerId, role: 'presenter' },
        ];

        for (const cohost of extractCohosts(event)) {
            const cohostId = String(cohost.id);
            if (!cohostId || !cohost.name || cohostId === ownerId) continue;

            const cohostAccount = await findOrCreateAccount({
                account_id: cohostId,
                name: cohost.name,
                type: 'facebook',
                // Graph API cohosts on event nodes are pages by definition.
                kind: 'fb_page',
            });
            if (cohostAccount) {
                // Use the resolved account_id (may differ from cohostId when
                // findOrCreateAccount deduped by name to an existing row).
                organizers.push({ account_id: String(cohostAccount.account_id), role: 'presenter' });
            }
        }

        const loc = event.place?.location;
        const hasCoords = loc?.latitude != null && loc?.longitude != null;
        // FB events without a physical place are typically online; with a
        // place + coords they're in-person. is_online flag (when present)
        // is more authoritative than the coord heuristic.
        const format: 'in_person' | 'online' = event.is_online === true
            ? 'online'
            : hasCoords ? 'in_person' : 'online';

        ingests.push({
            name: event.name ?? '(unnamed)',
            description: event.description ?? null,
            start_time: event.start_time,
            end_time: event.end_time ?? null,
            timezone: event.timezone ?? null,
            format,
            location: event.place?.name ?? null,
            location_details: hasCoords
                ? { latitude: loc!.latitude, longitude: loc!.longitude }
                : null,
            city: loc?.city ?? null,
            region: loc?.region ?? null,
            country: loc?.country ?? null,
            cover_photo: event.cover?.source ?? null,
            source: 'facebook',
            source_id: String(event.id),
            source_url: `https://www.facebook.com/events/${event.id}`,
            // Token-based Graph API access — partnership tier.
            ingest_kind: 'partnership',
            raw: event as unknown,
            organizers,
        });
    }

    return ingests;
}
