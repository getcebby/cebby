#!/usr/bin/env -S deno run --allow-net --allow-read --allow-env --node-modules-dir=auto --no-config
/**
 * Backfill `event_organizers` for FB events that have `source='facebook'` but
 * no organizer row. Re-scrapes each event via the public FB page (using the
 * same `facebook-event-scraper` npm package the manual fb-scraper function
 * uses), finds-or-creates an account per Page-type host, and links them via
 * `event_organizers`.
 *
 * Run from `services/facebook/`:
 *   deno run --allow-net --allow-read --allow-env --node-modules-dir=auto --no-config \
 *       scripts/backfill-stranded-organizers.ts [--dry-run] [--limit N]
 *
 * Defaults to LIVE mode against staging (whatever PUBLIC_SUPABASE_URL points
 * at in apps/pwa/.env). Use --dry-run first to preview.
 */

import { createClient } from 'jsr:@supabase/supabase-js';
import { scrapeFbEventFromFbid } from 'npm:facebook-event-scraper';

// --- Args ----------------------------------------------------------------------

const dryRun = Deno.args.includes('--dry-run');
const includeExisting = Deno.args.includes('--all');
const limitFlag = Deno.args.find((a) => a.startsWith('--limit='));
const limit = limitFlag ? parseInt(limitFlag.split('=')[1], 10) : Infinity;
const eventIdFlag = Deno.args.find((a) => a.startsWith('--event-id='));
const eventIdFilter = eventIdFlag ? parseInt(eventIdFlag.split('=')[1], 10) : null;

// --- Env loading from apps/pwa/.env -------------------------------------------

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
        console.warn(`[backfill] Could not read .env at ${path}:`, e instanceof Error ? e.message : e);
    }
}

const SCRIPT_DIR = new URL('.', import.meta.url).pathname;
const ENV_PATH = `${SCRIPT_DIR}../../../apps/pwa/.env`;
await loadEnv(ENV_PATH);

const SUPA_URL = Deno.env.get('PUBLIC_SUPABASE_URL');
const SUPA_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
if (!SUPA_URL || !SUPA_KEY) {
    console.error('[backfill] Missing PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in apps/pwa/.env');
    Deno.exit(1);
}

const supabase = createClient(SUPA_URL, SUPA_KEY);

// --- Types ---------------------------------------------------------------------

interface StrandedEvent {
    id: number;
    name: string;
    source_id: string;
    start_time: string;
}

interface FbHost {
    id: string | number;
    name: string;
    type: 'User' | 'Page';
    photo?: { url: string } | null;
}

// --- Stranded-events lookup ----------------------------------------------------

async function listEvents(): Promise<StrandedEvent[]> {
    // Single-event mode (testing): bypass everything else.
    if (eventIdFilter !== null) {
        const { data, error } = await supabase
            .from('events')
            .select('id, name, source_id, start_time')
            .eq('id', eventIdFilter)
            .eq('source', 'facebook')
            .single();
        if (error || !data) {
            console.error(`[backfill] event id=${eventIdFilter} not found or not facebook`);
            Deno.exit(1);
        }
        return [data as StrandedEvent];
    }

    // Two queries instead of one anti-join because PostgREST struggles with the
    // disambiguation now that events has multiple paths to event_organizers.
    const { data: fbEvents, error } = await supabase
        .from('events')
        .select('id, name, source_id, start_time')
        .eq('source', 'facebook')
        .not('source_id', 'is', null)
        .order('start_time', { ascending: false });

    if (error) {
        console.error('[backfill] error listing FB events:', error.message);
        Deno.exit(1);
    }

    const all = (fbEvents ?? []) as StrandedEvent[];
    if (all.length === 0) return [];

    // --all: process every FB event regardless of current organizer count.
    // Upserts on event_organizers dedupe safely; this catches missing cohosts
    // on events that already had a primary organizer attributed.
    if (includeExisting) return all;

    const { data: existing, error: orgErr } = await supabase
        .from('event_organizers')
        .select('event_id')
        .in('event_id', all.map((e) => e.id));
    if (orgErr) {
        console.error('[backfill] error fetching event_organizers:', orgErr.message);
        Deno.exit(1);
    }

    const haveOrganizer = new Set((existing ?? []).map((r) => r.event_id));
    return all.filter((e) => !haveOrganizer.has(e.id));
}

// --- Per-event work ------------------------------------------------------------

async function scrapeHosts(eventId: string): Promise<FbHost[] | null> {
    try {
        const event = await scrapeFbEventFromFbid(eventId);
        const hosts = (event.hosts ?? []) as FbHost[];
        // Permissive: accept any host with a usable id + name. FB's host
        // classification (Page vs User) is unreliable for some community
        // accounts; the kind column on accounts records the distinction
        // anyway, and "any name is better than stranded" wins for backfill.
        return hosts.filter((h) => !!h.id && !!h.name);
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`     scrape failed: ${msg}`);
        return null;
    }
}

function kindFor(host: FbHost): 'fb_page' | 'fb_user' {
    // The npm scraper's type field is unreliable for community pages on public
    // events — it routinely returns 'User' for what are clearly community pages
    // (GDG Cebu, UXPH, etc.). Since public FB events are overwhelmingly
    // community-hosted, default to fb_page; admin can reclassify the rare
    // genuine-individual case later via the orgs UI.
    return 'fb_page';
}

/**
 * Resolve a scraped host to a canonical accounts.account_id, creating a new
 * row only when neither the platform ID nor the name already exist. This
 * prevents the "PizzaPy gets two account rows" duplication that happens
 * because the npm scraper returns FB's public-facing user-style IDs for the
 * same community page that the FB cron already has under its internal ID.
 */
async function ensureAccount(host: FbHost): Promise<string | null> {
    if (dryRun) return String(host.id);

    const scrapedId = String(host.id);

    // 1. Exact match by platform ID (covers re-runs).
    const { data: byId } = await supabase
        .from('accounts')
        .select('account_id')
        .eq('account_id', scrapedId)
        .maybeSingle();
    if (byId) return byId.account_id as string;

    // 2. Dedupe by exact name (case-insensitive) within the same source. If a
    //    community page already exists with this name (likely from the FB cron
    //    using internal IDs), reuse it instead of creating a parallel row.
    const { data: byName } = await supabase
        .from('accounts')
        .select('account_id')
        .eq('type', 'facebook')
        .ilike('name', host.name)
        .limit(1)
        .maybeSingle();
    if (byName) {
        return byName.account_id as string;
    }

    // 3. Genuinely new — create.
    const { error } = await supabase
        .from('accounts')
        .insert({
            account_id: scrapedId,
            name: host.name,
            type: 'facebook',
            kind: kindFor(host),
            primary_photo: host.photo?.url ?? null,
            is_active: true,
        });
    if (error) {
        console.warn(`     account create failed for ${scrapedId}: ${error.message}`);
        return null;
    }
    return scrapedId;
}

async function linkOrganizers(eventId: number, hosts: FbHost[]): Promise<number> {
    if (hosts.length === 0) return 0;
    if (dryRun) return hosts.length;

    let linked = 0;
    for (let i = 0; i < hosts.length; i++) {
        const host = hosts[i];
        const resolvedId = await ensureAccount(host);
        if (!resolvedId) continue;

        const { error } = await supabase
            .from('event_organizers')
            .upsert(
                {
                    event_id: eventId,
                    account_id: resolvedId,
                    role: 'presenter',
                    position: i,
                },
                { onConflict: 'event_id,account_id' },
            );
        if (error) {
            console.warn(`     organizer link failed for ${eventId}/${resolvedId}: ${error.message}`);
            continue;
        }
        linked++;
    }
    return linked;
}

// --- Main loop -----------------------------------------------------------------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
    console.log(`[backfill] mode: ${dryRun ? 'DRY RUN — no writes' : 'LIVE'}`);
    console.log(`[backfill] target: ${SUPA_URL}`);
    console.log(`[backfill] scope: ${
        eventIdFilter !== null
            ? `single event id=${eventIdFilter}`
            : includeExisting
              ? 'ALL FB events (enrich existing organizers)'
              : 'stranded FB events only'
    }`);
    if (Number.isFinite(limit)) console.log(`[backfill] limit: ${limit}`);
    console.log('');

    const stranded = await listEvents();
    console.log(`[backfill] found ${stranded.length} event(s) to process\n`);

    const work = stranded.slice(0, Number.isFinite(limit) ? (limit as number) : stranded.length);

    let attributed = 0;
    let scrapeFailed = 0;
    let noPageHosts = 0;

    for (let i = 0; i < work.length; i++) {
        const event = work[i];
        const idx = `[${i + 1}/${work.length}]`;
        const truncated = event.name.length > 60 ? `${event.name.slice(0, 60)}…` : event.name;
        console.log(`${idx} id=${event.id} — ${truncated}`);

        const hosts = await scrapeHosts(event.source_id);
        if (hosts === null) {
            scrapeFailed++;
            await sleep(1500);
            continue;
        }
        if (hosts.length === 0) {
            console.log(`     no hosts found on the FB page — skipping`);
            noPageHosts++;
            await sleep(1500);
            continue;
        }

        console.log(`     hosts: ${hosts.map((h) => `${h.name} (${h.id}, ${kindFor(h)})`).join(', ')}`);
        const linked = await linkOrganizers(event.id, hosts);
        console.log(`     ${dryRun ? 'WOULD link' : 'linked'} ${linked} organizer(s)`);
        if (linked > 0) attributed++;

        // Polite gap to avoid tripping FB rate limits. The manual fb-scraper
        // doesn't loop, so this is the first time we're hammering the public
        // page in bulk — start conservatively.
        if (i < work.length - 1) await sleep(1500);
    }

    console.log('\n[backfill] done');
    console.log(`  total seen:     ${work.length}`);
    console.log(`  attributed:     ${attributed}`);
    console.log(`  scrape failed:  ${scrapeFailed}`);
    console.log(`  no hosts found: ${noPageHosts}`);
    if (dryRun) {
        console.log(`\n(dry run — no writes performed; re-run without --dry-run to apply)`);
    }
}

main().catch((err) => {
    console.error('[backfill] fatal:', err instanceof Error ? err.stack ?? err.message : err);
    Deno.exit(1);
});
