import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { supabase, supabaseUrl } from '@service/core/supabase/shared/client.ts';
import { Tables } from '@service/core/supabase/shared/database.types.ts';

/**
 * Optional orchestrator — lists active Eventbrite accounts and fans out.
 * Prefer pg_cron → fan_out_account_syncs once the per-account fn is real.
 * Scaffold keeps this for local smoke / parity with Luma.
 */
const fnAuthKey = Deno.env.get('INTERNAL_FN_JWT') ?? Deno.env.get('SUPABASE_ANON_KEY')!;

Deno.serve(async () => {
    try {
        const { data: accounts, error } = await supabase
            .from('accounts')
            .select('*')
            .eq('type', 'eventbrite')
            .eq('is_active', true);

        if (error) throw new Error(`Error fetching accounts: ${error.message}`);

        const list = (accounts ?? []) as Tables<'accounts'>[];
        console.log(`[eventbrite-cron] ${list.length} active Eventbrite account(s) (scaffold fan-out)`);

        const settled = await Promise.allSettled(
            list.map(async (account) => {
                const res = await fetch(
                    `${supabaseUrl}/functions/v1/retrieve-and-sync-to-db-eventbrite-events`,
                    {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            Authorization: `Bearer ${fnAuthKey}`,
                        },
                        body: JSON.stringify(account),
                    },
                );
                return {
                    account_id: account.account_id,
                    status: res.status,
                    body: (await res.text()).slice(0, 300),
                };
            }),
        );

        const fetches = settled.map((s) =>
            s.status === 'fulfilled' ? s.value : { error: String(s.reason) }
        );

        return new Response(
            JSON.stringify({
                message: `Scaffold sync attempted for ${list.length} Eventbrite account(s)`,
                accounts: list.length,
                fetches,
                todo: 'Implement scraper before enabling pg_cron',
            }),
            { headers: { 'Content-Type': 'application/json' } },
        );
    } catch (error) {
        console.error('[eventbrite-cron] orchestrator error:', error);
        return new Response(
            JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
            { status: 500, headers: { 'Content-Type': 'application/json' } },
        );
    }
});
