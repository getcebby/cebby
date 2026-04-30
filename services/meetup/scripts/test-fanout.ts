#!/usr/bin/env -S deno run --allow-net --allow-read --allow-env --no-config
/**
 * One-liner test: trigger the meetup cron fan-out NOW and report results
 * per group. Same call pg_cron would make at the next 15-min boundary,
 * just earlier.
 *
 * Usage:
 *   deno run --allow-net --allow-read --allow-env --no-config \
 *       services/meetup/scripts/test-fanout.ts [--wait=120] [--single=<account_id>]
 *
 * Flags:
 *   --wait=N         seconds to poll for cron responses (default 90)
 *   --single=<id>    invoke just one account directly (skips fan-out RPC).
 *                    Useful for debugging one group without waiting on
 *                    pg_net delivery to all 15.
 *
 * Reads PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from apps/pwa/.env.
 */

import { createClient } from 'jsr:@supabase/supabase-js';

const waitFlag = Deno.args.find((a) => a.startsWith('--wait='));
const waitSec = waitFlag ? parseInt(waitFlag.split('=')[1], 10) : 90;
const singleFlag = Deno.args.find((a) => a.startsWith('--single='));
const singleAccount = singleFlag ? singleFlag.split('=')[1] : null;

// --- env loading from apps/pwa/.env ---

async function loadEnv(path: string): Promise<void> {
    try {
        const text = await Deno.readTextFile(path);
        for (const line of text.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            const m = trimmed.match(/^([A-Z_][A-Z0-9_]*)=(.+)$/i);
            if (!m) continue;
            const [, key, value] = m;
            if (Deno.env.get(key)) continue;
            Deno.env.set(key, value.trim());
        }
    } catch (e) {
        console.warn(`[test-fanout] could not read .env at ${path}:`, e instanceof Error ? e.message : e);
    }
}

const SCRIPT_DIR = new URL('.', import.meta.url).pathname;
await loadEnv(`${SCRIPT_DIR}../../../apps/pwa/.env`);

const SUPA_URL = Deno.env.get('PUBLIC_SUPABASE_URL');
const SUPA_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
if (!SUPA_URL || !SUPA_KEY) {
    console.error('[test-fanout] missing PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in apps/pwa/.env');
    Deno.exit(1);
}
const supabase = createClient(SUPA_URL, SUPA_KEY, { auth: { persistSession: false } });
const FN_URL = `${SUPA_URL}/functions/v1/retrieve-and-sync-to-db-meetup-events`;

// --- single-account direct invoke ---

async function invokeSingle(accountId: string): Promise<void> {
    const { data: account, error } = await supabase
        .from('accounts')
        .select('*')
        .eq('account_id', accountId)
        .eq('type', 'meetup')
        .maybeSingle();
    if (error || !account) {
        console.error(`[test-fanout] meetup account "${accountId}" not found`);
        Deno.exit(1);
    }
    console.log(`[test-fanout] invoking ${FN_URL} with account=${accountId}…`);
    const t0 = Date.now();
    const res = await fetch(FN_URL, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${SUPA_KEY}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(account),
    });
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    const body = await res.text();
    console.log(`[test-fanout] HTTP ${res.status} in ${elapsed}s`);
    console.log(body);
}

// --- fan-out + poll ---

interface CallRow {
    response_at: string;
    status_code: number;
    body_preview: string;
}

interface ParsedCall {
    response_at: string;
    status_code: number;
    account_id: string | null;
    ingested: number | null;
    raw: string;
}

function parseBody(body_preview: string): { account_id: string | null; ingested: number | null } {
    try {
        const m = body_preview.match(/^\{[^}]*\}/);
        if (!m) return { account_id: null, ingested: null };
        const j = JSON.parse(m[0]) as { account_id?: string; ingested?: number };
        return { account_id: j.account_id ?? null, ingested: j.ingested ?? null };
    } catch {
        return { account_id: null, ingested: null };
    }
}

async function fanOutAndPoll(): Promise<void> {
    const startedAt = new Date().toISOString();
    console.log(`[test-fanout] startedAt=${startedAt}`);
    console.log(`[test-fanout] calling fan_out_account_syncs(meetup, …)`);

    const { data: count, error: rpcErr } = await supabase.rpc('fan_out_account_syncs', {
        p_type: 'meetup',
        p_fn_url: FN_URL,
    });
    if (rpcErr) {
        console.error(`[test-fanout] rpc failed: ${rpcErr.message}`);
        Deno.exit(1);
    }
    console.log(`[test-fanout] fan-out enqueued ${count} account(s); polling for ${waitSec}s…\n`);

    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    const seen = new Map<string, ParsedCall>();
    const deadline = Date.now() + waitSec * 1000;
    while (Date.now() < deadline) {
        const { data, error } = await supabase
            .from('recent_ingest_calls')
            .select('response_at,status_code,body_preview')
            .gte('response_at', startedAt)
            .order('response_at', { ascending: true })
            .limit(50);
        if (error) {
            console.error(`[test-fanout] poll error: ${error.message}`);
            break;
        }
        for (const r of (data ?? []) as CallRow[]) {
            const parsed = parseBody(r.body_preview ?? '');
            if (!parsed.account_id) continue;
            if (seen.has(parsed.account_id)) continue;
            seen.set(parsed.account_id, {
                response_at: r.response_at,
                status_code: r.status_code,
                account_id: parsed.account_id,
                ingested: parsed.ingested,
                raw: r.body_preview ?? '',
            });
            const flag = r.status_code >= 200 && r.status_code < 300 ? '✓' : '✗';
            const ing = parsed.ingested ?? '?';
            console.log(`  ${flag} ${parsed.account_id.padEnd(55)} HTTP ${r.status_code}  ingested=${ing}`);
        }
        if (seen.size >= (count as number)) break;
        await sleep(2000);
    }

    const total = seen.size;
    const expected = count as number;
    const ok = [...seen.values()].filter((r) => r.status_code >= 200 && r.status_code < 300);
    const totalIngested = ok.reduce((s, r) => s + (r.ingested ?? 0), 0);

    console.log('');
    console.log('[test-fanout] summary');
    console.log(`  responses received: ${total}/${expected}${total < expected ? ' (still in flight — re-run with --wait= for longer)' : ''}`);
    console.log(`  successful (2xx):   ${ok.length}`);
    console.log(`  total events ingested: ${totalIngested}`);
    if (totalIngested === 0) {
        console.log('');
        console.log('  All groups returned 0 events. This is normal when Cebu Meetup');
        console.log('  has no upcoming events across the seeded 15 groups. To verify,');
        console.log('  open any group page (e.g. https://www.meetup.com/pizzapy-ph/events/)');
        console.log('  and check whether it lists upcoming events.');
    }
}

// --- main ---

if (singleAccount) {
    await invokeSingle(singleAccount);
} else {
    await fanOutAndPoll();
}
