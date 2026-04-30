import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { Account, IngestEvent } from '@service/core/supabase/shared/types.ts';
import {
    findOrCreateAccount,
    geocodeEventLocations,
    getEventsByIds,
    ingestEvents,
    storeCoverImages,
} from '@service/core/supabase/features/events/index.ts';
import { fetchEventsForLumaPath } from '../_shared/lumautils.ts';
import { LumaAccountDetails, LumaEvent } from '../_shared/types.ts';

async function buildIngestForCalendarEvent(
    event: LumaEvent,
): Promise<IngestEvent | null> {
    // Attribution flows from the event itself, not the account that discovered
    // it. So an event found via user/princejohn but presented by GOAB attributes
    // to GOAB. Hosted-by users are not presenter attribution.
    const presenters = event.presenters.length > 0 ? event.presenters : event.presenter ? [event.presenter] : [];
    if (presenters.length === 0) {
        console.warn(
            `[luma-cron] event ${event.api_id} has no Presented by attribution — ingesting without organizers`,
        );
    }

    const organizers = [];
    for (const presenter of presenters) {
        const account = await findOrCreateAccount({
            account_id: presenter.api_id,
            name: presenter.name,
            type: 'luma',
            kind: presenter.kind,
            primary_photo: presenter.avatar,
        });
        if (!account) {
            console.warn(
                `[luma-cron] event ${event.api_id} — could not persist presenter account ${presenter.api_id}`,
            );
            continue;
        }
        organizers.push({ account_id: presenter.api_id, role: 'presenter' });
    }
    if (presenters.length > 0 && organizers.length === 0) {
        console.warn(
            `[luma-cron] event ${event.api_id} — could not persist any presenter accounts`,
        );
        return null;
    }

    // Format derivation. Luma's location_type tells us directly: anything
    // non-'offline' is online (zoom/meet/teams/online). Hybrid not surfaced
    // by Luma — tag as in_person if physical address exists, online otherwise.
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
        // Luma is HTML-scraped via __NEXT_DATA__ — public_scrape tier.
        // Reserved for future tier upgrade if Luma gives us official API access.
        ingest_kind: 'public_scrape',
        raw: event as unknown,
        organizers,
    };
}

async function processCalendar(account: Account) {
    const { account_id } = account;

    // v2: accounts.discovery_path is a typed column (was account_details.path
    // pre-v2). Cast loosely until database.types.ts is regenerated against v2.
    const a = account as Account & { discovery_path?: string | null };
    const path = a.discovery_path;

    // Optional label kept on account_details for log context only.
    const details = (account.account_details as LumaAccountDetails | null) ?? {};

    if (!path) {
        console.warn(
            `[luma-cron] account ${account_id} has no discovery_path — skipping`,
        );
        return null;
    }

    console.log(
        `[luma-cron] processing path "${path}" for account ${account_id}${details.label ? ` (${details.label})` : ''}`,
    );

    const events = await fetchEventsForLumaPath(path);
    console.log(
        `[luma-cron] retrieved ${events.length} future event(s) from path ${path}`,
    );

    const ingests: IngestEvent[] = [];
    for (const event of events) {
        const ingest = await buildIngestForCalendarEvent(event);
        if (ingest) ingests.push(ingest);
    }

    const results = await ingestEvents(ingests);
    console.log(
        `[luma-cron] ingested ${results.length} for ${account_id}: ` +
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

        // Await synchronously. EdgeRuntime.waitUntil silently aborted the
        // background work when invoked from the orchestrator's fan-out — so
        // we make the function block until the actual scrape+ingest finishes.
        // Trade-off: response time = scrape time (5-30s for a busy calendar).
        // Acceptable for cron orchestration and gives reliable visibility.
        const results = await processCalendar(account);
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
        console.error('[luma-cron] error processing calendar:', error);
        return new Response(
            JSON.stringify({
                error: error instanceof Error ? error.message : String(error),
            }),
            {
                status: 500,
                headers: { 'Content-Type': 'application/json' },
            },
        );
    }
});
