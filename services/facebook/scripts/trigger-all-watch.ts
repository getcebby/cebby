#!/usr/bin/env -S deno run --no-config --allow-net --allow-env --allow-read --allow-sys
/**
 * Batch-invoke retrieve-and-sync-to-db-events for every active facebook
 * account with ingest_kind='public_scrape'. Serialized with a short gap
 * between accounts so we don't slam FB with parallel public scrapes.
 *
 * Usage:
 *   deno run --no-config --allow-net --allow-env --allow-read --allow-sys \
 *     services/facebook/scripts/trigger-all-watch.ts
 *
 *   --gap-ms=N    Delay between accounts (default 8000ms)
 */

import { load } from 'jsr:@std/dotenv@0.225';
import { createClient } from 'npm:@supabase/supabase-js@2';

const env = await load({ envPath: '/Users/dorelljames/Projects/cebby/services/core/scripts/.env.migration', export: false });
const URL_V2 = env.NEW_SUPABASE_URL!;
const KEY_V2 = env.NEW_SUPABASE_SERVICE_ROLE_KEY!;
const GAP_MS = Number(Deno.args.find((a) => a.startsWith('--gap-ms='))?.slice('--gap-ms='.length) ?? 8000);

const supabase = createClient(URL_V2, KEY_V2, { auth: { persistSession: false } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Pull all active FB watch accounts (excludes partnership token-backed ones).
const { data: accounts, error: accErr } = await supabase
    .from('accounts')
    .select('*')
    .eq('type', 'facebook')
    .eq('ingest_kind', 'public_scrape')
    .eq('is_active', true)
    .order('account_id', { ascending: true });
if (accErr) {
    console.error(`Read failed: ${accErr.message}`);
    Deno.exit(1);
}
console.log(`Found ${accounts!.length} active facebook public_scrape accounts.`);

const { data: secret } = await supabase
    .from('app_secrets')
    .select('value')
    .eq('name', 'internal_fn_jwt')
    .maybeSingle();
const fnJwt = (secret as { value: string } | null)?.value;
if (!fnJwt) {
    console.error('Missing app_secrets.internal_fn_jwt');
    Deno.exit(1);
}

console.log('');
let ok = 0, fail = 0, totalIngested = 0;
for (let i = 0; i < accounts!.length; i++) {
    const account = accounts![i];
    if (i > 0) await sleep(GAP_MS);
    const tag = `[${i + 1}/${accounts!.length}]`;
    console.log(`${tag} ${account.account_id}  (${account.name})`);
    try {
        const start = Date.now();
        const res = await fetch(`${URL_V2}/functions/v1/retrieve-and-sync-to-db-events`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${fnJwt}` },
            body: JSON.stringify(account),
        });
        const text = await res.text();
        const ms = Date.now() - start;
        if (res.ok) {
            ok++;
            // Parse ingested count if present
            try {
                const body = JSON.parse(text);
                if (typeof body.ingested === 'number') totalIngested += body.ingested;
                console.log(`     → HTTP ${res.status} (${ms}ms)  ${body.message ?? ''}`);
            } catch {
                console.log(`     → HTTP ${res.status} (${ms}ms)`);
            }
        } else {
            fail++;
            console.log(`     → HTTP ${res.status} (${ms}ms)  ${text.slice(0, 200)}`);
        }
    } catch (err) {
        fail++;
        console.log(`     → fetch threw: ${err instanceof Error ? err.message : String(err)}`);
    }
}

console.log('\n=== Summary ===');
console.log(`accounts: ${accounts!.length}  ok: ${ok}  fail: ${fail}  events ingested: ${totalIngested}`);
