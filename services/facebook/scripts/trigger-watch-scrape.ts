#!/usr/bin/env -S deno run --no-config --allow-net --allow-env --allow-read --allow-sys
/**
 * Manually trigger retrieve-and-sync-to-db-events for one watch account
 * without waiting for the next 6h cron tick. Useful for verifying the
 * watch-list scrape path end-to-end and for re-running after fixes.
 *
 * Usage:
 *   deno run --no-config --allow-net --allow-env --allow-read --allow-sys \
 *     services/facebook/scripts/trigger-watch-scrape.ts <account_id>
 *
 *   # Example:
 *   ... trigger-watch-scrape.ts DOHEPhilippines
 */

import { load } from 'jsr:@std/dotenv@0.225';
import { createClient } from 'npm:@supabase/supabase-js@2';

const ENV_PATH = new URL('../../core/scripts/.env.migration', import.meta.url).pathname;
const env = await load({ envPath: ENV_PATH, export: false });

const URL_V2 = env.NEW_SUPABASE_URL ?? Deno.env.get('NEW_SUPABASE_URL');
const KEY_V2 = env.NEW_SUPABASE_SERVICE_ROLE_KEY ?? Deno.env.get('NEW_SUPABASE_SERVICE_ROLE_KEY');
if (!URL_V2 || !KEY_V2) {
    console.error('✗ Missing NEW_SUPABASE_* in .env.migration');
    Deno.exit(1);
}

const accountId = Deno.args[0];
if (!accountId) {
    console.error('Usage: trigger-watch-scrape.ts <account_id>');
    Deno.exit(1);
}

const supabase = createClient(URL_V2, KEY_V2, { auth: { persistSession: false } });

console.log(`Fetching account ${accountId} ...`);
const { data: account, error: accErr } = await supabase
    .from('accounts')
    .select('*')
    .eq('account_id', accountId)
    .maybeSingle();

if (accErr) {
    console.error(`✗ Read failed: ${accErr.message}`);
    Deno.exit(1);
}
if (!account) {
    console.error(`✗ No account with account_id="${accountId}"`);
    Deno.exit(1);
}

console.log(`Found: ${account.name}  type=${account.type}  ingest_kind=${account.ingest_kind}  is_active=${account.is_active}`);
console.log('JSON body to POST:', JSON.stringify(account));

// Edge functions require the legacy JWT-format key (eyJ...). The new
// sb_secret_* service key works for DB calls but not for the function
// invocation gate. The legacy anon JWT used by pg_cron is stored in
// app_secrets.internal_fn_jwt — reuse it here.
const { data: secretRow, error: secretErr } = await supabase
    .from('app_secrets')
    .select('value')
    .eq('name', 'internal_fn_jwt')
    .maybeSingle();
if (secretErr || !secretRow) {
    console.error(`✗ Could not read app_secrets.internal_fn_jwt: ${secretErr?.message ?? 'not found'}`);
    Deno.exit(1);
}
const fnJwt = (secretRow as { value: string }).value;

console.log(`Invoking retrieve-and-sync-to-db-events ...`);
const start = Date.now();
const res = await fetch(`${URL_V2}/functions/v1/retrieve-and-sync-to-db-events`, {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${fnJwt}`,
    },
    body: JSON.stringify(account),
});

const text = await res.text();
const ms = Date.now() - start;
console.log(`\nHTTP ${res.status}  (${ms}ms)`);
console.log(text);

if (!res.ok) Deno.exit(1);
