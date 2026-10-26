import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { Account } from '@service/core/supabase/shared/types.ts';
import { recordServiceHealthEvent } from '@service/core/supabase/shared/service-health.ts';

/**
 * Per-account Eventbrite sync target (pg_net fan-out body = accounts row).
 * Scaffold: records a warning health event and returns 501.
 */
Deno.serve(async (req) => {
    let account: Account | null = null;
    try {
        account = await req.json() as Account;
        const path = (account as Account & { discovery_path?: string | null }).discovery_path;

        await recordServiceHealthEvent({
            bucket: 'eventbrite',
            source: 'retrieve-and-sync-to-db-eventbrite-events',
            status: 'warning',
            severity: 'warning',
            fingerprint: 'scaffold_not_implemented',
            account_id: account.account_id,
            message: `Eventbrite sync stub — account ${account.account_id} path=${path ?? 'null'}`,
            metadata: { scaffold: true },
        });

        return new Response(
            JSON.stringify({
                error: 'Eventbrite organizer sync not implemented yet',
                todo: true,
                account_id: account.account_id,
                discovery_path: path ?? null,
            }),
            { status: 501, headers: { 'Content-Type': 'application/json' } },
        );
    } catch (error) {
        console.error('[eventbrite-cron] error:', error);
        await recordServiceHealthEvent({
            bucket: 'eventbrite',
            source: 'retrieve-and-sync-to-db-eventbrite-events',
            status: 'error',
            severity: 'error',
            fingerprint: 'cron_account_failed',
            account_id: account?.account_id ?? null,
            message: error instanceof Error ? error.message : String(error),
        });
        return new Response(
            JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
            { status: 500, headers: { 'Content-Type': 'application/json' } },
        );
    }
});
