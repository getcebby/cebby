import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { supabase } from '@service/core/supabase/shared/client.ts';
import { recordServiceHealthEvent } from '@service/core/supabase/shared/service-health.ts';
import { planOrganizerImports } from '../_shared/discovery.ts';
import { importEventbriteEvent } from '../_shared/import-event.ts';
import { syncOrganizer } from '../_shared/sync-organizer.ts';
import { handleSyncRequest } from '../_shared/sync-request.ts';
import type { AccountRow } from '../_shared/watched-organizer.ts';

/**
 * Per-organizer Eventbrite sync. pg_cron's `sync-eventbrite-accounts` (:45 every
 * 6 hours) calls public.fan_out_account_syncs('eventbrite', …), which POSTs each
 * active Eventbrite account row here. It reads the organizer's upcoming events,
 * imports the ones that count for Cebby (in person in Cebu, or online when the
 * account is Cebu-based; a series as its next 2 dates within 60 days) and records
 * one health row for the "Finding new events" line on /status. The rules live in
 * _shared/sync-request.ts; this file only wires the database and the network.
 *
 * Routing is mirrored by public.finding_targets() (migration 20261105010000):
 * every active Eventbrite account is a target. Change both together.
 */

async function lookupAccount(accountId: string): Promise<AccountRow | null> {
    const { data, error } = await supabase
        .from('accounts')
        .select('account_id, type, is_active, is_cebu_based')
        .eq('account_id', accountId)
        .maybeSingle();
    if (error) throw new Error(`account lookup failed: ${error.message}`);
    return data as AccountRow | null;
}

Deno.serve(async (req) => {
    const body = await req.json().catch(() => null);
    // Awaited, as in the Meetup and Luma crons: EdgeRuntime.waitUntil is
    // aborted when the call comes from pg_net's fan-out.
    const result = await handleSyncRequest(body, {
        lookupAccount,
        sync: (organizer) =>
            syncOrganizer(organizer, { plan: planOrganizerImports, importOne: importEventbriteEvent, now: new Date() }),
        record: recordServiceHealthEvent,
    });
    if (result.status === 500) console.error('[eventbrite-cron] error:', result.body.error);
    return new Response(JSON.stringify(result.body), {
        status: result.status,
        headers: { 'Content-Type': 'application/json' },
    });
});
