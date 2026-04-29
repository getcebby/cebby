import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { supabase, supabaseUrl } from '@service/core/supabase/shared/client.ts';
import { Tables } from '@service/core/supabase/shared/database.types.ts';

// Function-to-function auth: Supabase's new key system auto-injects both
// SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY in `sb_publishable_` /
// `sb_secret_` format on this project, but the Edge Functions verify_jwt
// middleware still wants legacy JWT format. We set INTERNAL_FN_JWT as a
// custom secret holding the legacy JWT-format anon key, just for these
// internal fan-out calls.
const fnAuthKey = Deno.env.get('INTERNAL_FN_JWT') ?? Deno.env.get('SUPABASE_ANON_KEY')!;

Deno.serve(async () => {
    try {
        console.log('Fetching active Luma accounts...');
        const { data: accounts, error } = await supabase
            .from('accounts')
            .select('*')
            .eq('type', 'luma')
            .eq('is_active', true);

        if (error) {
            throw new Error(`Error fetching accounts: ${error.message}`);
        }

        console.log(`Fetched ${accounts.length} active Luma account(s).`);

        // Fan-out synchronously and capture each fetch's outcome so the
        // orchestrator's response is debuggable end-to-end.
        const settled = await Promise.allSettled(
            accounts.map(async (account: Tables<'accounts'>) => {
                const start = Date.now();
                try {
                    const res = await fetch(`${supabaseUrl}/functions/v1/retrieve-and-sync-to-db-luma-events`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            Authorization: `Bearer ${fnAuthKey}`,
                        },
                        body: JSON.stringify(account),
                    });
                    const body = await res.text();
                    return {
                        account_id: account.account_id,
                        status: res.status,
                        ms: Date.now() - start,
                        body: body.slice(0, 300),
                    };
                } catch (err) {
                    return {
                        account_id: account.account_id,
                        ms: Date.now() - start,
                        error: err instanceof Error ? err.message : String(err),
                    };
                }
            }),
        );

        const fetches = settled.map((s) =>
            s.status === 'fulfilled'
                ? s.value
                : { error: 'unexpected promise rejection', detail: String(s.reason) },
        );

        const data = {
            message: `Sync attempted for ${accounts.length} Luma account(s)`,
            accounts: accounts.length,
            fetches,
        };
        console.log(data.message);

        return new Response(JSON.stringify(data), {
            headers: { 'Content-Type': 'application/json' },
        });
    } catch (error) {
        console.error('Error in Deno.serve:', error);
        return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
            headers: { 'Content-Type': 'application/json' },
        });
    }
});
