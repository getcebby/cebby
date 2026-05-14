import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { scrapeFbEventFromFbid, scrapeFbEventList, EventType } from 'npm:facebook-event-scraper';
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
import { buildIngestFromFbEvent, retrieveEventsFromFacebook } from '../_shared/events.ts';
import { FacebookEvent } from '../_shared/types.ts';
import { FacebookOrganizerHost, resolveFacebookOrganizerHosts } from '../_shared/organizers.ts';

/** Polite gap between back-to-back FB public-scrape calls. FB rate-limits
 * fast public-scrape bursts; smoke-test confirmed ~2.5s avoids the worst.
 */
const PUBLIC_SCRAPE_GAP_MS = 2500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Build the page-events URL for a given watch account. `discovery_path`
 * holds the FB slug (e.g. "DOHEPhilippines") or the numeric profile id.
 * Strips a leading "@" because facebook-event-scraper rejects it as
 * "Invalid Facebook page event URL".
 */
function buildPageEventsUrl(account: Account): string | null {
    const path = (account.discovery_path ?? account.account_id ?? '').replace(/^@+/, '').trim();
    if (!path) return null;
    // facebook-event-scraper auto-detects page vs profile from URL shape, so
    // we don't have to. Pure-numeric paths get the page-style URL too —
    // the lib's dispatcher handles it.
    return `https://www.facebook.com/${path}/upcoming_hosted_events`;
}

/** From a scraped event's hosts, find the one that represents the watch
 * account itself (so we can pull its display name / photo). Matches against
 * either the host's numeric id (when the watch row was keyed numerically)
 * or its URL path (when the watch row uses a slug as account_id).
 */
function findSelfHost(
    event: { hosts?: Array<{ id?: string | number; name?: string; url?: string; photo?: { url?: string; imageUri?: string } | null }> },
    account: Account,
): { id: string; name: string; photoUrl: string | null } | null {
    const slug = (account.discovery_path ?? account.account_id ?? '').replace(/^@+/, '').toLowerCase();
    if (!slug) return null;
    for (const h of event.hosts ?? []) {
        if (h.id == null || !h.name) continue;
        if (String(h.id) === account.account_id) {
            return { id: String(h.id), name: h.name, photoUrl: h.photo?.imageUri ?? h.photo?.url ?? null };
        }
        const path = (h.url ?? '')
            .replace(/^https?:\/\/(www\.)?facebook\.com\//, '')
            .split('?')[0]
            .replace(/\/+$/, '')
            .toLowerCase();
        if (path === slug) {
            return { id: String(h.id), name: h.name, photoUrl: h.photo?.imageUri ?? h.photo?.url ?? null };
        }
        // profile.php?id=<numeric> — pure-numeric watch entries
        if (/^\d+$/.test(slug) && (h.url ?? '').includes(`id=${slug}`)) {
            return { id: String(h.id), name: h.name, photoUrl: h.photo?.imageUri ?? h.photo?.url ?? null };
        }
    }
    return null;
}

/** Update the watch row's name + primary_photo from the FB-returned host
 * data — but only when the existing values look like an unedited import
 * placeholder. This is what lets findOrCreateAccount's FB name-dedup
 * collapse the slug-keyed watch row with the numeric host attribution on
 * subsequent events / cron ticks.
 *
 * Run once per cron tick (on the first event whose hosts we can match).
 */
async function alignWatchAccountMetadata(
    account: Account,
    selfHost: { name: string; photoUrl: string | null },
): Promise<void> {
    const placeholderName = account.discovery_path != null && account.name === account.discovery_path
        || account.name === account.account_id;
    const updates: { name?: string; primary_photo?: string | null } = {};
    if (placeholderName && selfHost.name && selfHost.name !== account.name) {
        updates.name = selfHost.name;
    }
    if (!account.primary_photo && selfHost.photoUrl) {
        updates.primary_photo = selfHost.photoUrl;
    }
    if (Object.keys(updates).length === 0) return;

    const { error } = await supabase
        .from('accounts')
        .update(updates)
        .eq('account_id', account.account_id);
    if (error) {
        console.warn(`[fb-cron] watch metadata update failed for ${account.account_id}: ${error.message}`);
        return;
    }
    console.log(
        `[fb-cron] watch metadata aligned for ${account.account_id}: ${JSON.stringify(updates)}`,
    );
    // Reflect locally so subsequent dedup paths see the updated name.
    if (updates.name) account.name = updates.name;
    if (updates.primary_photo !== undefined) account.primary_photo = updates.primary_photo;
}

/** Reconcile a slug-keyed watch row with its numeric counterpart so we
 * don't keep two parallel rows for the same FB entity.
 *
 * Two cases after the watch path learns the host's numeric id:
 *
 *   A. A row with account_id=<numeric> already exists (e.g. created
 *      during a prior partnership-cohost ingest, often sitting with
 *      discovery_path=NULL so the cron couldn't scrape it). Copy the
 *      slug-keyed row's discovery_path/primary_photo onto the numeric
 *      row and deactivate the slug-keyed row. The numeric row now
 *      carries watch-list duty.
 *
 *   B. No numeric-id row exists. Rewrite the slug-keyed row's account_id
 *      to the numeric id in-place. PK rewrite is safe at first-ingest
 *      because no event_organizers / account_secrets / event_source_links
 *      reference the slug-keyed row yet (the ingest that just ran will
 *      attribute to the numeric id directly via findOrCreateAccount).
 *
 * Idempotent — runs once per tick after the alignment step.
 */
async function reconcileWatchRowToNumeric(
    slugRow: Account,
    numericId: string,
): Promise<void> {
    if (slugRow.account_id === numericId) return;

    const { data: numeric, error: selectErr } = await supabase
        .from('accounts')
        .select('account_id, name, primary_photo, discovery_path, is_active')
        .eq('account_id', numericId)
        .maybeSingle();
    if (selectErr) {
        console.warn(`[fb-cron] reconcile select failed for ${numericId}: ${selectErr.message}`);
        return;
    }

    if (!numeric) {
        // Case B: rewrite slug-keyed row's PK to numeric. Safe because no
        // FKs reference it yet at first ingest.
        const { error: rewriteErr } = await supabase
            .from('accounts')
            .update({ account_id: numericId })
            .eq('account_id', slugRow.account_id);
        if (rewriteErr) {
            console.warn(
                `[fb-cron] reconcile case-B (PK rewrite ${slugRow.account_id} → ${numericId}) failed: ${rewriteErr.message}`,
            );
            return;
        }
        console.log(`[fb-cron] reconciled (case B): ${slugRow.account_id} → ${numericId}`);
        slugRow.account_id = numericId;
        return;
    }

    // Case A: numeric row pre-exists. Backfill discovery_path / primary_photo
    // onto it, then deactivate the slug-keyed row.
    const numericUpdates: Record<string, unknown> = {};
    if (!numeric.discovery_path && slugRow.discovery_path) {
        numericUpdates.discovery_path = slugRow.discovery_path;
    }
    if (!numeric.primary_photo && slugRow.primary_photo) {
        numericUpdates.primary_photo = slugRow.primary_photo;
    }
    // Always ensure the numeric row is the active watch-target.
    if (numeric.is_active === false) numericUpdates.is_active = true;
    if (Object.keys(numericUpdates).length > 0) {
        const { error: numericErr } = await supabase
            .from('accounts')
            .update(numericUpdates)
            .eq('account_id', numericId);
        if (numericErr) {
            console.warn(`[fb-cron] reconcile case-A numeric update failed: ${numericErr.message}`);
            return;
        }
    }
    // Deactivate the slug-keyed row (don't delete — defensive against any
    // event_organizers rows that may already reference it from earlier
    // ticks of an iterated import).
    const { error: deactivateErr } = await supabase
        .from('accounts')
        .update({ is_active: false })
        .eq('account_id', slugRow.account_id);
    if (deactivateErr) {
        console.warn(`[fb-cron] reconcile case-A deactivate failed: ${deactivateErr.message}`);
        return;
    }
    console.log(
        `[fb-cron] reconciled (case A): slug ${slugRow.account_id} → numeric ${numericId} ` +
            `(numericUpdates=${JSON.stringify(numericUpdates)}; slug deactivated)`,
    );
}

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

/**
 * No-token watch-list path. Iterates upcoming events for a FB page/profile
 * via the public HTML scrape (facebook-event-scraper). Tolerates the lib's
 * common "No event data found" error as a soft fail — page may simply
 * have zero upcoming events, or FB may be temporarily blocking the public
 * listing. The next cron tick retries.
 *
 * User-type hosts are allowed for this path (allowUserHosts=true) since
 * watch-list entries are explicit operator opt-ins — many community pages
 * are exposed as User profiles, not Pages, and would otherwise never
 * ingest.
 */
async function processViaPublicScrape(account: Account) {
    const { account_id } = account;
    // discovery_path is the explicit "we know how to scrape this" signal.
    // Without it, the row is most likely a cohost stub auto-created by
    // host attribution — not a deliberate watch target. Skip silently
    // so we don't waste an HTTP call on a URL we built from a numeric id
    // that FB's public scrape can't resolve.
    if (!account.discovery_path) {
        console.log(
            `[fb-cron] account ${account_id} has no discovery_path — not a watch target, skipping`,
        );
        return null;
    }
    const url = buildPageEventsUrl(account);
    if (!url) {
        console.warn(
            `[fb-cron] watch account ${account_id} missing discovery_path/account_id — cannot build scrape URL`,
        );
        return null;
    }
    console.log(`[fb-cron] watch-list scrape: ${url}`);

    let list;
    try {
        list = await scrapeFbEventList(url, EventType.Upcoming);
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Soft-fail: "No event data found" is indistinguishable from "page
        // is fine but has zero upcoming events" — we surface it as a
        // warning health event, not an error, so a single quiet page
        // doesn't poison the bucket health.
        const isSoft = /no event data found|invalid facebook page event url/i.test(msg);
        console[isSoft ? 'warn' : 'error'](
            `[fb-cron] watch-list list failed for ${account_id}: ${msg}`,
        );
        await recordServiceHealthEvent({
            bucket: 'facebook',
            source: 'retrieve-and-sync-to-db-events',
            status: isSoft ? 'warning' : 'error',
            severity: isSoft ? 'warning' : 'error',
            fingerprint: isSoft ? 'watch_no_events' : 'watch_list_failed',
            account_id,
            message: msg,
        });
        return isSoft ? [] : null;
    }
    console.log(`[fb-cron] watch-list found ${list.length} upcoming events for ${account_id}`);

    // Per-event scrape with a polite gap.
    //
    // FB's /upcoming_hosted_events listing surfaces shared / promoted /
    // related events alongside genuinely-hosted ones. To prevent the
    // watch path from ingesting concerts and unrelated content just
    // because a watched page shared them, we require findSelfHost to
    // return non-null for each event — i.e. the watched account must
    // appear in event.hosts. Otherwise skip.
    //
    // On the first event whose hosts we can match, we also learn the
    // FB host's numeric id and (when the row is a fresh import
    // placeholder) align the watch row's name/photo. Numeric id
    // capture is unconditional once selfHost is known so reconciliation
    // works on subsequent ticks even if metadata is already aligned.
    const ingests: IngestEvent[] = [];
    let selfHostDiscovered = false;
    let learnedNumericId: string | null = null;
    let skippedNonHost = 0;
    for (let i = 0; i < list.length; i++) {
        if (i > 0) await sleep(PUBLIC_SCRAPE_GAP_MS);
        const shortEvent = list[i];
        try {
            const event = await scrapeFbEventFromFbid(shortEvent.id);
            const selfHost = findSelfHost(event, account);
            if (!selfHost) {
                skippedNonHost++;
                console.log(
                    `[fb-cron] skip ${shortEvent.id} "${(event.name ?? '').slice(0, 50)}" — ` +
                        `${account_id} listed it but isn't among its hosts`,
                );
                continue;
            }
            if (!selfHostDiscovered) {
                selfHostDiscovered = true;
                if (/^\d+$/.test(selfHost.id)) learnedNumericId = selfHost.id;
                await alignWatchAccountMetadata(account, selfHost);
            }
            const ingest = await buildIngestFromFbEvent(event, { allowUserHosts: true });
            if (ingest) ingests.push(ingest);
        } catch (err) {
            console.warn(
                `[fb-cron] per-event scrape failed for ${shortEvent.id} (${account_id}): ${
                    err instanceof Error ? err.message : String(err)
                }`,
            );
        }
    }
    if (skippedNonHost > 0) {
        console.log(`[fb-cron] ${account_id}: skipped ${skippedNonHost} non-host event(s) from listing`);
    }

    if (ingests.length === 0) {
        console.log(`[fb-cron] watch-list nothing ingestable for ${account_id}`);
        return [];
    }

    const results = await ingestEvents(ingests);
    console.log(
        `[fb-cron] watch-list ingested ${results.length} for ${account_id}: ` +
            `${results.filter((r) => r.is_new_event).length} new, ` +
            `${results.filter((r) => !r.is_new_event).length} matched/re-scraped`,
    );

    // Reconcile the slug-keyed watch row with its numeric counterpart so
    // future ticks iterate one row, not two. Runs after ingest so the
    // numeric row (if findOrCreateAccount just created it) exists.
    if (learnedNumericId) {
        await reconcileWatchRowToNumeric(account, learnedNumericId);
    }

    // Enrichment — same fire-and-forget pattern as the partnership path.
    const eventRows = await getEventsByIds(results.map((r) => r.event_id));
    await storeCoverImages(eventRows);
    await geocodeEventLocations(eventRows);

    return results;
}

async function processEvents(account: Account) {
    const { account_id } = account;

    console.log(`[fb-cron] processing events for account: ${account_id}`);

    const tokens = await fetchAccountTokens(account_id);
    const token = tokens?.page_access_token ?? tokens?.access_token;
    if (!token) {
        // No partnership token — route to the public-scrape watch path when
        // the account is configured for it. Other ingest_kinds (manual,
        // unknown) are intentionally left untouched here.
        if (account.ingest_kind === 'public_scrape') {
            return await processViaPublicScrape(account);
        }
        console.warn(
            `[fb-cron] account ${account_id} has no token and ingest_kind="${account.ingest_kind}" — ` +
                `skipping (set ingest_kind='public_scrape' to enable watch-list scraping)`,
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
