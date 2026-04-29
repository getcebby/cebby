import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { supabase, supabaseUrl } from '@service/core/supabase/shared/client.ts';
import { Tables } from '@service/core/supabase/shared/database.types.ts';

// See cron-sync-luma-calendars for why we read INTERNAL_FN_JWT here.
const fnAuthKey = Deno.env.get('INTERNAL_FN_JWT') ?? Deno.env.get('SUPABASE_ANON_KEY')!;

Deno.serve(async () => {
    try {
        console.log('Fetching active Facebook accounts...');
        const { data: accounts, error } = await supabase
            .from('accounts')
            .select('*')
            .eq('type', 'facebook')
            .eq('is_active', true);

        if (error) {
            throw new Error(`Error fetching accounts: ${error.message}`);
        }

        console.log(`Fetched ${accounts.length} active Facebook account(s).`);

        const fetchPromises = accounts.map((account: Tables<'accounts'>) => {
            console.log(`Calling function for account ${account.account_id}...`);
            return fetch(`${supabaseUrl}/functions/v1/retrieve-and-sync-to-db-events`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${fnAuthKey}`,
                },
                body: JSON.stringify(account),
            })
                .then(async (response) => {
                    if (!response.ok) {
                        const body = await response.text().catch(() => '');
                        throw new Error(`Error calling function for account ${account.account_id}: HTTP ${response.status} ${body.slice(0, 200)}`);
                    }
                    console.log(`Successfully called function for account ${account.account_id}.`);
                })
                .catch((error) => {
                    console.error(`Error calling function for account ${account.account_id}:`, error);
                });
        });

        // Synchronous await — see cron-sync-luma-calendars for rationale.
        const settled = await Promise.allSettled(fetchPromises);
        const failed = settled.filter((r) => r.status === 'rejected').length;

        const data = {
            message: `Sync queued for ${accounts.length} Facebook account(s); ${failed} fetch failure(s)`,
            accounts: accounts.length,
            failed,
        };

        console.log(data.message);

        return new Response(JSON.stringify(data), {
            headers: { 'Content-Type': 'application/json' },
        });
    } catch (error) {
        console.error('Error in Deno.serve:', error);
        return new Response(JSON.stringify({ error: error.message }), {
            headers: { 'Content-Type': 'application/json' },
        });
    }
});
