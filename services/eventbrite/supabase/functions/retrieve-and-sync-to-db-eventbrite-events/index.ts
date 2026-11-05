import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { supabase } from '@service/core/supabase/shared/client.ts';
import { recordServiceHealthEvent } from '@service/core/supabase/shared/service-health.ts';
import { type FindingRun, findingMetadata } from '@service/core/supabase/shared/health-checks.ts';
import { planOrganizerImports } from '../_shared/discovery.ts';
import { importEventbriteEvent } from '../_shared/import-event.ts';
import { syncOrganizer } from '../_shared/sync-organizer.ts';
import { type AccountRow, resolveWatchedOrganizer } from '../_shared/watched-organizer.ts';

/**
 * Per-organizer Eventbrite sync. pg_cron's `sync-eventbrite-accounts` (:45 every
 * 6 hours) calls public.fan_out_account_syncs('eventbrite', …), which POSTs each
 * active Eventbrite account row here. It reads the organizer's upcoming events,
 * imports the ones that count for Cebby (in person in Cebu, or online when the
 * account is Cebu-based; a series as its next 2 dates within 60 days) and records
 * one health row for the "Finding new events" line on /status.
 *
 * Routing is mirrored by public.finding_targets() (migration 20261105010000):
 * every active Eventbrite account is a target. Change both together.
 */

const SOURCE = 'retrieve-and-sync-to-db-eventbrite-events';

type AccountBody = { account_id?: string };

async function lookupAccount(accountId: string): Promise<AccountRow | null> {
    const { data, error } = await supabase
        .from('accounts')
        .select('account_id, type, is_active, is_cebu_based')
        .eq('account_id', accountId)
        .maybeSingle();
    if (error) throw new Error(`account lookup failed: ${error.message}`);
    return data as AccountRow | null;
}

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
    let account: AccountBody | null = null;
    let run: FindingRun = { line: null, pageRead: null };
    try {
        account = await req.json() as AccountBody;
        if (!account?.account_id) return json({ error: 'account_id is required' }, 400);
        // The body is only a hint (any valid JWT reaches this function): what to
        // sync, and how, comes from the accounts table.
        const organizer = await resolveWatchedOrganizer(account.account_id, lookupAccount);
        if (!organizer) return json({ error: `${account.account_id} is not a watched Eventbrite organizer` }, 404);

        // Awaited, as in the Meetup and Luma crons: EdgeRuntime.waitUntil is
        // aborted when the call comes from pg_net's fan-out.
        const result = await syncOrganizer(organizer, {
            plan: planOrganizerImports,
            importOne: importEventbriteEvent,
            now: new Date(),
        });
        run = result.run;

        await recordServiceHealthEvent({
            bucket: 'eventbrite',
            source: SOURCE,
            status: 'success',
            severity: 'info',
            fingerprint: 'account_processed',
            account_id: organizer.account_id,
            message: `processed organizer ${organizer.account_id} (${result.ingested} event(s))`,
            metadata: { ingested: result.ingested, ...findingMetadata(run) },
        });
        // One row per date that failed to import. No `line` key: these don't count
        // toward the finding line, which is about reading the organizer.
        for (const failure of result.failures) {
            await recordServiceHealthEvent({
                bucket: 'eventbrite',
                source: SOURCE,
                status: 'warning',
                severity: 'warning',
                fingerprint: 'event_import_failed',
                account_id: organizer.account_id,
                message: failure.message,
                metadata: { event_url: failure.url },
            });
        }

        return json({ account_id: organizer.account_id, ingested: result.ingested, failures: result.failures.length });
    } catch (error) {
        console.error('[eventbrite-cron] error:', error);
        await recordServiceHealthEvent({
            bucket: 'eventbrite',
            source: SOURCE,
            status: 'error',
            severity: 'error',
            fingerprint: 'cron_account_failed',
            account_id: account?.account_id ?? null,
            message: error instanceof Error ? error.message : String(error),
            metadata: findingMetadata({ ...run, line: 'finding' }, { crashed: true, error }),
        });
        return json({ error: error instanceof Error ? error.message : String(error) }, 500);
    }
});
