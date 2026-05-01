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
import { recordServiceHealthEvent } from '@service/core/supabase/shared/service-health.ts';
import { retrieveEventsFromFacebook } from '../_shared/events.ts';
import { FacebookEvent } from '../_shared/types.ts';
import { FacebookOrganizerHost, resolveFacebookOrganizerHosts } from '../_shared/organizers.ts';

/** v2: tokens live on account_secrets, not on accounts. */
async function fetchAccountTokens(
    accountId: string,
): Promise<{ access_token: string | null; page_access_token: string | null } | null> {
    const { data, error } = await supabase
        .from('account_secrets' as any)
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
    const fields = 'id,name,cover,description,created_time,timezone,start_time,end_time,' +
        'place{name,location{city,region,country,country_code,latitude,longitude}},' +
        'cohosts';
    const url =
        `https://graph.facebook.com/v21.0/${pageId}/events?fields=${fields}&access_token=${token}&format=json&method=get`;

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
    let account: Account | null = null;
    try {
        account = await req.json() as Account;
        const activeAccount = account;

        // Synchronous — see retrieve-and-sync-to-db-luma-events for rationale.
        const results = await processEvents(activeAccount);
        const ingested = Array.isArray(results) ? results.length : 0;
        await recordServiceHealthEvent({
            bucket: 'facebook',
            source: 'retrieve-and-sync-to-db-events',
            status: Array.isArray(results) ? 'success' : 'warning',
            severity: Array.isArray(results) ? 'info' : 'warning',
            fingerprint: Array.isArray(results) ? 'account_processed' : 'account_skipped',
            account_id: activeAccount.account_id,
            message: `processed account ${activeAccount.account_id} (${ingested} event(s))`,
            metadata: { ingested },
        });

        return new Response(
            JSON.stringify({
                message: `processed account ${activeAccount.account_id} (${ingested} event(s))`,
                account_id: activeAccount.account_id,
                ingested,
            }),
            {
                headers: { 'Content-Type': 'application/json' },
            },
        );
    } catch (error) {
        console.error('[fb-cron] error processing events:', error);
        await recordServiceHealthEvent({
            bucket: 'facebook',
            source: 'retrieve-and-sync-to-db-events',
            status: 'error',
            severity: 'error',
            fingerprint: 'cron_account_failed',
            account_id: account?.account_id ?? null,
            message: error instanceof Error ? error.message : String(error),
        });
        return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
});

async function mapEventsToIngest(events: FacebookEvent[], account: Account): Promise<IngestEvent[]> {
    const ingests: IngestEvent[] = [];

    for (const event of events) {
        // Graph's page-events edge can return shared events when syncing a
        // cohost, so the synced account is not always the primary "Event by"
        // organizer. Public event HTML exposes the displayed host order; use it
        // when available and only fall back to owner+cohosts if the scrape fails.
        const organizerResolution = await resolveFacebookOrganizerHosts(event, account);
        const organizers: Array<{ account_id: string; role?: string }> = [];
        for (const host of organizerResolution.hosts) {
            const accountId = await resolveOrganizerAccount(host);
            if (accountId) organizers.push({ account_id: accountId, role: 'presenter' });
        }

        const loc = event.place?.location;
        const hasCoords = loc?.latitude != null && loc?.longitude != null;
        // FB events without a physical place are typically online; with a
        // place + coords they're in-person. is_online flag (when present)
        // is more authoritative than the coord heuristic.
        const format: 'in_person' | 'online' = event.is_online === true ? 'online' : hasCoords ? 'in_person' : 'online';

        ingests.push({
            name: event.name ?? '(unnamed)',
            description: event.description ?? null,
            start_time: event.start_time,
            end_time: event.end_time ?? null,
            timezone: event.timezone ?? null,
            format,
            location: event.place?.name ?? null,
            location_details: hasCoords ? { latitude: loc!.latitude, longitude: loc!.longitude } : null,
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
            organizer_write_mode: organizerResolution.source === 'public_hosts' ? 'replace' : 'merge',
        });
    }

    return ingests;
}

async function resolveOrganizerAccount(host: FacebookOrganizerHost): Promise<string | null> {
    if (host.source === 'graph_owner') return host.id;

    const account = await findOrCreateAccount({
        account_id: host.id,
        name: host.name,
        type: 'facebook',
        kind: 'fb_page',
        primary_photo: host.photoUrl ?? null,
    });
    return account ? String(account.account_id) : null;
}
