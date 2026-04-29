import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { supabase, supabaseKey, supabaseUrl } from '@service/core/supabase/shared/client.ts';
import { Tables } from '@service/core/supabase/shared/database.types.ts';

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

        const fetchPromises = accounts.map((account: Tables<'accounts'>) => {
            console.log(`Calling sync function for Luma account ${account.id}...`);
            return fetch(`${supabaseUrl}/functions/v1/retrieve-and-sync-to-db-luma-events`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${supabaseKey}`,
                },
                body: JSON.stringify(account),
            })
                .then((response) => {
                    if (!response.ok) {
                        throw new Error(`Error calling function for account ${account.id}: ${response.statusText}`);
                    }
                    console.log(`Successfully called function for account ${account.id}.`);
                })
                .catch((err) => {
                    console.error(`Error calling function for account ${account.id}:`, err);
                });
        });

        Promise.allSettled(fetchPromises);

        const data = {
            message: `Successfully called sync functions for ${accounts.length} Luma account(s)`,
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
