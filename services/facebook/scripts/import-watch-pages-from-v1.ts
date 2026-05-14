#!/usr/bin/env -S deno run --no-config --allow-net --allow-env --allow-read --allow-sys
/**
 * Import v1 prod `facebook_pages` rows into v2 `accounts` as public-scrape
 * watch entries. Mirrors decisions from the design session:
 *
 *   - account_id = slug (or numeric profile id) — text PK accepts both.
 *     Numeric id gets unified later via findOrCreateAccount's name-dedup
 *     once the first event for the page lands.
 *   - discovery_path = slug, with leading "@" stripped (FB lib rejects it).
 *   - type='facebook', kind='fb_page', ingest_kind='public_scrape',
 *     is_active=is_active (v1 column).
 *   - Idempotent: skip rows whose account_id already exists in v2 (likely a
 *     partnership account that overlaps with the v1 watch list).
 *
 * Usage:
 *   deno run --no-config --allow-net --allow-env --allow-read --allow-sys \
 *     services/facebook/scripts/import-watch-pages-from-v1.ts
 *
 *     --apply        Actually write to v2. Without it, prints a plan only.
 *     --limit=N      Cap rows processed (test with --limit=3).
 */

import { load } from 'jsr:@std/dotenv@0.225';
import { createClient } from 'npm:@supabase/supabase-js@2';

// ----------------------------------------------------------------------------
// 1. Env
// ----------------------------------------------------------------------------

const ENV_PATH = new URL('../../core/scripts/.env.migration', import.meta.url).pathname;
const env = await load({ envPath: ENV_PATH, export: false });

const LIVE_URL = env.LIVE_SUPABASE_URL ?? Deno.env.get('LIVE_SUPABASE_URL');
const LIVE_KEY = env.LIVE_SUPABASE_SERVICE_ROLE_KEY ?? Deno.env.get('LIVE_SUPABASE_SERVICE_ROLE_KEY');
const NEW_URL = env.NEW_SUPABASE_URL ?? Deno.env.get('NEW_SUPABASE_URL');
const NEW_KEY = env.NEW_SUPABASE_SERVICE_ROLE_KEY ?? Deno.env.get('NEW_SUPABASE_SERVICE_ROLE_KEY');

if (!LIVE_URL || !LIVE_KEY || !NEW_URL || !NEW_KEY) {
    console.error(`✗ Missing LIVE_SUPABASE_* / NEW_SUPABASE_* (env: ${ENV_PATH})`);
    Deno.exit(1);
}

const APPLY = Deno.args.includes('--apply');
const LIMIT_ARG = Deno.args.find((a) => a.startsWith('--limit='))?.slice('--limit='.length);
const LIMIT = LIMIT_ARG ? Number(LIMIT_ARG) : Infinity;

console.log(`mode: ${APPLY ? 'APPLY (will write to v2)' : 'DRY-RUN (no writes)'}`);
console.log(`v1 source: ${LIVE_URL}`);
console.log(`v2 target: ${NEW_URL}`);
if (Number.isFinite(LIMIT)) console.log(`limit: ${LIMIT}`);
console.log('');

// ----------------------------------------------------------------------------
// 2. Clients
// ----------------------------------------------------------------------------

const live = createClient(LIVE_URL, LIVE_KEY, { auth: { persistSession: false } });
const next = createClient(NEW_URL, NEW_KEY, { auth: { persistSession: false } });

// ----------------------------------------------------------------------------
// 3. Read v1 facebook_pages
// ----------------------------------------------------------------------------

interface V1FacebookPage {
    id: number;
    username: string;
    url: string;
    is_active: boolean;
    created_at: string;
}

const { data: v1Rows, error: v1Err } = await live
    .from('facebook_pages')
    .select('id, username, url, is_active, created_at')
    .order('id', { ascending: true });

if (v1Err) {
    console.error(`✗ Failed reading v1 facebook_pages: ${v1Err.message}`);
    Deno.exit(1);
}
const rows: V1FacebookPage[] = (v1Rows ?? []).slice(0, Number.isFinite(LIMIT) ? LIMIT : undefined);
console.log(`Read ${rows.length} row(s) from v1 facebook_pages.`);

// ----------------------------------------------------------------------------
// 4. Build v2 account payloads
// ----------------------------------------------------------------------------

interface PlannedAccount {
    v1Id: number;
    sourceUsername: string;
    sourceUrl: string;
    accountId: string;
    discoveryPath: string;
    accountIdShape: 'slug' | 'numeric-profile';
    isActive: boolean;
}

function buildPayload(row: V1FacebookPage): PlannedAccount | { skip: string } {
    const raw = (row.username ?? '').trim();
    if (!raw) return { skip: 'empty username' };
    // Strip leading @ (FB lib rejects "@-prefixed" URLs).
    const slug = raw.replace(/^@+/, '');
    if (!slug) return { skip: 'username was only "@"' };

    // The one profile row in v1 has username="61574188777317" — a numeric
    // FB profile id. Treat that as the canonical account_id directly.
    const isNumericProfile = /^\d+$/.test(slug);

    return {
        v1Id: row.id,
        sourceUsername: row.username,
        sourceUrl: row.url,
        accountId: slug,
        discoveryPath: slug,
        accountIdShape: isNumericProfile ? 'numeric-profile' : 'slug',
        isActive: !!row.is_active,
    };
}

const planned: PlannedAccount[] = [];
const skipped: Array<{ v1Id: number; username: string; reason: string }> = [];
for (const row of rows) {
    const result = buildPayload(row);
    if ('skip' in result) {
        skipped.push({ v1Id: row.id, username: row.username, reason: result.skip });
    } else {
        planned.push(result);
    }
}

// ----------------------------------------------------------------------------
// 5. Cross-check against v2 — flag pre-existing rows so we don't double-import
// ----------------------------------------------------------------------------

const candidateAccountIds = planned.map((p) => p.accountId);
const { data: existingByAccountId } = await next
    .from('accounts')
    .select('account_id, name, type, ingest_kind, discovery_path')
    .in('account_id', candidateAccountIds);

const existingById = new Map<string, { name: string | null; ingest_kind: string | null }>();
for (const r of (existingByAccountId ?? []) as Array<{
    account_id: string;
    name: string | null;
    ingest_kind: string | null;
}>) {
    existingById.set(r.account_id, { name: r.name, ingest_kind: r.ingest_kind });
}

// Also probe by discovery_path in case the operator pre-populated some rows
// (e.g., admin used "Add watched page" before this import ran).
const { data: existingByPath } = await next
    .from('accounts')
    .select('account_id, name, discovery_path, ingest_kind')
    .eq('type', 'facebook')
    .in('discovery_path', candidateAccountIds);

const existingByDiscovery = new Map<string, { account_id: string; name: string | null }>();
for (const r of (existingByPath ?? []) as Array<{
    account_id: string;
    name: string | null;
    discovery_path: string | null;
}>) {
    if (r.discovery_path) existingByDiscovery.set(r.discovery_path, { account_id: r.account_id, name: r.name });
}

// ----------------------------------------------------------------------------
// 6. Print the plan
// ----------------------------------------------------------------------------

console.log('\n=== PLAN ===');
console.log(`${'v1#'.padStart(3)}  ${'shape'.padEnd(15)}  ${'account_id'.padEnd(34)}  ${'status'.padEnd(20)}  v1.username`);
console.log('-'.repeat(110));

interface Action {
    plan: PlannedAccount;
    action: 'insert' | 'skip-existing-id' | 'skip-existing-discovery';
    reason?: string;
}
const actions: Action[] = [];

for (const p of planned) {
    const byId = existingById.get(p.accountId);
    const byPath = existingByDiscovery.get(p.accountId);
    let action: Action['action'];
    let status: string;
    if (byId) {
        action = 'skip-existing-id';
        status = `skip (exists: ${byId.ingest_kind ?? '?'})`;
    } else if (byPath) {
        action = 'skip-existing-discovery';
        status = `skip (path→${byPath.account_id})`;
    } else {
        action = 'insert';
        status = 'INSERT';
    }
    actions.push({ plan: p, action, reason: status });
    console.log(
        `${String(p.v1Id).padStart(3)}  ${p.accountIdShape.padEnd(15)}  ${p.accountId.padEnd(34)}  ${
            status.padEnd(20)
        }  ${p.sourceUsername}`,
    );
}

for (const s of skipped) {
    console.log(`${String(s.v1Id).padStart(3)}  ${'(invalid)'.padEnd(15)}  ${''.padEnd(34)}  skip (${s.reason})  ${s.username}`);
}

const toInsert = actions.filter((a) => a.action === 'insert');
console.log('');
console.log(`Summary: ${toInsert.length} to insert · ${actions.length - toInsert.length} already present · ${skipped.length} invalid v1 rows`);

// ----------------------------------------------------------------------------
// 7. Apply (only when --apply)
// ----------------------------------------------------------------------------

if (!APPLY) {
    console.log('\nDry-run finished. Re-run with --apply to write to v2.');
    Deno.exit(0);
}

if (toInsert.length === 0) {
    console.log('\nNothing to insert; nothing to apply. Done.');
    Deno.exit(0);
}

const inserts = toInsert.map(({ plan }) => ({
    account_id: plan.accountId,
    // Seed name = slug so the cron's `alignWatchAccountMetadata` placeholder
    // check fires on the first successful scrape and replaces it with the
    // real FB display name. Using sourceUsername (which can include "@")
    // would break the placeholder match.
    name: plan.discoveryPath,
    type: 'facebook',
    kind: 'fb_page',
    discovery_path: plan.discoveryPath,
    ingest_kind: 'public_scrape',
    is_active: plan.isActive,
}));

console.log(`\nApplying — inserting ${inserts.length} rows into v2.accounts ...`);
const { data: inserted, error: insertErr } = await next
    .from('accounts')
    .insert(inserts)
    .select('account_id, name, ingest_kind');
if (insertErr) {
    console.error(`✗ Insert failed: ${insertErr.message}`);
    Deno.exit(1);
}
console.log(`✓ Inserted ${(inserted ?? []).length} rows.`);
for (const r of inserted ?? []) {
    console.log(`  + ${(r as { account_id: string }).account_id}  ${(r as { name: string }).name}`);
}
