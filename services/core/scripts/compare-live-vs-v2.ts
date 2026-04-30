#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --no-config
/**
 * Diff v1 LIVE production (qkhlgxdtodyyemkarouo) against v2 (the new project).
 *
 * Why: we migrated v2 from STAGING (utbymunzemtumroucqga). LIVE production
 * may have events that staging didn't have (different scrapers running, etc).
 * This script reports what's in LIVE but missing from v2 by source_id.
 *
 * Read-only on both sides. No writes.
 *
 * Usage:
 *   deno run --allow-net --allow-env --allow-read --no-config \
 *     services/core/scripts/compare-live-vs-v2.ts
 */

import { load } from 'jsr:@std/dotenv@0.225';
import { createClient } from 'npm:@supabase/supabase-js@2';

const ENV_PATH = new URL('./.env.migration', import.meta.url).pathname;
const env = await load({ envPath: ENV_PATH, export: false });

// LIVE production credentials live in services/core/scripts/.env.migration as
// LIVE_SUPABASE_URL and LIVE_SUPABASE_SERVICE_ROLE_KEY (gitignored).
const LIVE_URL = env.LIVE_SUPABASE_URL ?? Deno.env.get('LIVE_SUPABASE_URL');
const LIVE_SERVICE_KEY =
    env.LIVE_SUPABASE_SERVICE_ROLE_KEY ?? Deno.env.get('LIVE_SUPABASE_SERVICE_ROLE_KEY');
if (!LIVE_URL || !LIVE_SERVICE_KEY) {
    console.error('✗ Missing LIVE_SUPABASE_URL / LIVE_SUPABASE_SERVICE_ROLE_KEY in .env.migration');
    Deno.exit(1);
}

const NEW_URL = env.NEW_SUPABASE_URL ?? Deno.env.get('NEW_SUPABASE_URL');
const NEW_KEY = env.NEW_SUPABASE_SERVICE_ROLE_KEY ?? Deno.env.get('NEW_SUPABASE_SERVICE_ROLE_KEY');
if (!NEW_URL || !NEW_KEY) {
    console.error('✗ Missing NEW_SUPABASE_* in .env.migration');
    Deno.exit(1);
}

const live = createClient(LIVE_URL, LIVE_SERVICE_KEY, { auth: { persistSession: false } });
const v2   = createClient(NEW_URL, NEW_KEY, { auth: { persistSession: false } });


// =============================================================================
// 1. Read source-id index from each side
// =============================================================================

interface EventRow {
    id: number;
    name: string | null;
    start_time: string | null;
    source: string | null;
    source_id: string | null;
}

async function readAllEvents(
    client: ReturnType<typeof createClient>,
    label: string,
    isV2: boolean,
): Promise<EventRow[]> {
    // v2 dropped events.source / events.source_id — they live on
    // event_source_links now. Read only the fields each side has.
    const cols = isV2 ? 'id, name, start_time' : 'id, name, start_time, source, source_id';
    const PAGE = 1000;
    const out: EventRow[] = [];
    let from = 0;
    while (true) {
        const { data, error } = await client
            .from('events')
            .select(cols)
            .range(from, from + PAGE - 1);
        if (error) {
            console.error(`✗ ${label}: events read error: ${error.message}`);
            return out;
        }
        if (!data || data.length === 0) break;
        out.push(...(data as EventRow[]));
        if (data.length < PAGE) break;
        from += PAGE;
    }
    return out;
}

interface SourceLinkRow {
    source: string;
    source_id: string;
}

async function readV2SourceLinks(): Promise<Set<string>> {
    const PAGE = 1000;
    const out = new Set<string>();
    let from = 0;
    while (true) {
        const { data, error } = await v2
            .from('event_source_links')
            .select('source, source_id')
            .range(from, from + PAGE - 1);
        if (error) {
            console.error('✗ v2: event_source_links read error:', error.message);
            return out;
        }
        if (!data || data.length === 0) break;
        for (const row of data as SourceLinkRow[]) {
            out.add(`${row.source}::${row.source_id}`);
        }
        if (data.length < PAGE) break;
        from += PAGE;
    }
    return out;
}


// =============================================================================
// 2. Main: read both sides, diff, summarize
// =============================================================================

async function main() {
    console.log('\n=== v1 LIVE vs v2 comparison ===');
    console.log(`LIVE: ${LIVE_URL}`);
    console.log(`v2:   ${NEW_URL}\n`);

    console.log('reading LIVE events...');
    const liveEvents = await readAllEvents(live, 'LIVE', false);
    console.log(`  ${liveEvents.length} events`);

    console.log('reading v2 events...');
    const v2Events = await readAllEvents(v2, 'v2', true);
    console.log(`  ${v2Events.length} events`);

    console.log('reading v2 event_source_links...');
    const v2Keys = await readV2SourceLinks();
    console.log(`  ${v2Keys.size} (source, source_id) entries`);

    // Index LIVE events by their (source, source_id) key.
    const liveByKey = new Map<string, EventRow>();
    for (const e of liveEvents) {
        if (!e.source || !e.source_id) continue;
        liveByKey.set(`${e.source}::${e.source_id}`, e);
    }

    // Diff: events in LIVE whose (source, source_id) is NOT a key in v2.
    const missing: EventRow[] = [];
    for (const [key, ev] of liveByKey) {
        if (!v2Keys.has(key)) missing.push(ev);
    }

    console.log('\n=== diff ===');
    console.log(`LIVE-only (not in v2 source_links): ${missing.length}`);

    // Group missing by source for the punch-list.
    const bySource = new Map<string, EventRow[]>();
    for (const ev of missing) {
        const arr = bySource.get(ev.source ?? 'unknown') ?? [];
        arr.push(ev);
        bySource.set(ev.source ?? 'unknown', arr);
    }

    for (const [source, rows] of bySource) {
        console.log(`\n  ${source}: ${rows.length} missing — full list (recency-sorted):`);
        const sorted = [...rows].sort((a, b) => (b.start_time ?? '').localeCompare(a.start_time ?? ''));
        for (const r of sorted) {
            console.log(`    [${r.start_time?.slice(0, 10) ?? '?'}] ${r.name ?? '(unnamed)'}  source_id=${r.source_id}`);
        }
    }

    console.log('\n=== summary ===');
    console.log(`LIVE events:                       ${liveEvents.length}`);
    console.log(`v2 events:                         ${v2Events.length}`);
    console.log(`v2 source_links:                   ${v2Keys.size}`);
    console.log(`LIVE → v2 gap (need to migrate):   ${missing.length}`);

    if (missing.length > 0) {
        console.log(`\nNext step: bring missing LIVE events into v2.`);
        console.log(`Options:`);
        console.log(`  • For Luma: re-run cron-sync — calendars cover discoveries automatically`);
        console.log(`  • For FB: re-run rescrape-all-v2.ts which already handles new source_ids`);
        console.log(`  • For events that no longer exist on the source platform, accept as historical loss`);
    }
}

main().catch((err) => {
    console.error('\n✗ comparison failed:', err instanceof Error ? err.stack ?? err.message : err);
    Deno.exit(1);
});
