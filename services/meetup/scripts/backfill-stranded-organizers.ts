#!/usr/bin/env -S deno run --allow-net --allow-read --allow-env --no-config
/**
 * Backfill `event_organizers` for past Meetup events that have a
 * `meetup` source_link but no organizer row. The cron+scraper both filter
 * past events, so these never heal naturally.
 *
 * Strategy is pure data-derivation: extract the group urlname from the
 * source_link URL (always shaped `https://www.meetup.com/<urlname>/events/<id>/`),
 * look up the account in `accounts` (seeded by 20260430050000), and insert
 * the event_organizers row. No scraping needed — we already trust the URL.
 *
 * Run from anywhere (uses absolute path resolution):
 *   deno run --allow-net --allow-read --allow-env --no-config \
 *       services/meetup/scripts/backfill-stranded-organizers.ts [--dry-run] [--limit N]
 *
 * Reads PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from apps/pwa/.env.
 *
 * Idempotent: re-runs upsert with onConflict on the (event_id, account_id) PK.
 * Skips source_links whose urlname has no seeded account (logs warning;
 * we don't auto-create rogue accounts here).
 */

import { createClient } from 'jsr:@supabase/supabase-js';

const dryRun = Deno.args.includes('--dry-run');
const limitFlag = Deno.args.find((a) => a.startsWith('--limit='));
const limit = limitFlag ? parseInt(limitFlag.split('=')[1], 10) : Infinity;

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
        console.warn(`[backfill] could not read .env at ${path}:`, e instanceof Error ? e.message : e);
    }
}

const SCRIPT_DIR = new URL('.', import.meta.url).pathname;
const ENV_PATH = `${SCRIPT_DIR}../../../apps/pwa/.env`;
await loadEnv(ENV_PATH);

const SUPA_URL = Deno.env.get('PUBLIC_SUPABASE_URL');
const SUPA_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
if (!SUPA_URL || !SUPA_KEY) {
    console.error('[backfill] missing PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in apps/pwa/.env');
    Deno.exit(1);
}
const supabase = createClient(SUPA_URL, SUPA_KEY);

// --- core ---

interface SourceLinkRow {
    event_id: number;
    source_id: string;
    url: string;
    events: { name: string; start_time: string; event_organizers: { account_id: string }[] } | null;
}

const URLNAME_RE = /^https?:\/\/(?:www\.)?meetup\.com\/([^/]+)\/events\//i;

function extractUrlname(url: string | null): string | null {
    if (!url) return null;
    const m = url.match(URLNAME_RE);
    return m ? m[1] : null;
}

async function listStranded(): Promise<SourceLinkRow[]> {
    // FK disambiguation: events has both `events.id` (1:N to source_links via
    // event_id) and `primary_source_link_id` (N:1). Spell out the one we want.
    const { data, error } = await supabase
        .from('event_source_links')
        .select(
            'event_id, source_id, url, events!event_source_links_event_id_fkey(name,start_time,event_organizers(account_id))',
        )
        .eq('source', 'meetup')
        .order('scraped_at', { ascending: false });
    if (error) {
        console.error('[backfill] error listing meetup source_links:', error.message);
        Deno.exit(1);
    }
    const rows = (data ?? []) as unknown as SourceLinkRow[];
    return rows.filter((r) => !(r.events?.event_organizers ?? []).length);
}

async function accountExists(accountId: string): Promise<boolean> {
    const { data } = await supabase
        .from('accounts')
        .select('account_id')
        .eq('account_id', accountId)
        .eq('type', 'meetup')
        .maybeSingle();
    return !!data;
}

async function linkOrganizer(eventId: number, accountId: string): Promise<boolean> {
    if (dryRun) return true;
    const { error } = await supabase
        .from('event_organizers')
        .upsert(
            { event_id: eventId, account_id: accountId, role: 'presenter', position: 0 },
            { onConflict: 'event_id,account_id' },
        );
    if (error) {
        console.warn(`     organizer link failed for ${eventId}/${accountId}: ${error.message}`);
        return false;
    }
    return true;
}

// --- main ---

async function main() {
    console.log(`[backfill] mode:    ${dryRun ? 'DRY RUN — no writes' : 'LIVE'}`);
    console.log(`[backfill] target:  ${SUPA_URL}`);
    if (Number.isFinite(limit)) console.log(`[backfill] limit:   ${limit}`);
    console.log('');

    const stranded = await listStranded();
    console.log(`[backfill] found ${stranded.length} stranded meetup event(s)\n`);

    const work = stranded.slice(0, Number.isFinite(limit) ? (limit as number) : stranded.length);
    const verifiedAccounts = new Map<string, boolean>();

    let attributed = 0;
    let noUrlname = 0;
    let noAccount = 0;
    let failed = 0;

    for (let i = 0; i < work.length; i++) {
        const row = work[i];
        const idx = `[${i + 1}/${work.length}]`;
        const name = (row.events?.name ?? '(unnamed)').slice(0, 60);
        console.log(`${idx} event_id=${row.event_id} source_id=${row.source_id} — ${name}`);

        const urlname = extractUrlname(row.url);
        if (!urlname) {
            console.log(`     ⚠ could not parse urlname from ${row.url}`);
            noUrlname++;
            continue;
        }

        // Cache the lookup so 21 events from 9 distinct groups = 9 queries, not 21.
        let exists = verifiedAccounts.get(urlname);
        if (exists === undefined) {
            exists = await accountExists(urlname);
            verifiedAccounts.set(urlname, exists);
        }
        if (!exists) {
            console.log(`     ⚠ no seeded meetup account for urlname=${urlname} — skipping`);
            noAccount++;
            continue;
        }

        const ok = await linkOrganizer(row.event_id, urlname);
        if (!ok) {
            failed++;
            continue;
        }
        console.log(`     ${dryRun ? 'WOULD link' : 'linked'} ${urlname}`);
        attributed++;
    }

    console.log('');
    console.log('[backfill] done');
    console.log(`  total seen:        ${work.length}`);
    console.log(`  attributed:        ${attributed}`);
    console.log(`  url unparseable:   ${noUrlname}`);
    console.log(`  account not found: ${noAccount}`);
    console.log(`  link failed:       ${failed}`);
    if (dryRun) console.log('\n(dry run — no writes performed; re-run without --dry-run to apply)');
}

main().catch((err) => {
    console.error('[backfill] fatal:', err instanceof Error ? err.stack ?? err.message : err);
    Deno.exit(1);
});
