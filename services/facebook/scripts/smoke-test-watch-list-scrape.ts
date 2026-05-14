#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-sys
/**
 * Smoke-test: does facebook-event-scraper's scrapeFbEventList work on the
 * three URL shapes from the v1 facebook_pages watch list?
 *
 *   1. plain slug                   /<slug>/upcoming_hosted_events
 *   2. @-prefixed slug              /@<slug>/upcoming_hosted_events
 *   3. numeric profile.php          /profile.php?id=<id>&sk=upcoming_hosted_events
 *
 * For each URL we list upcoming events and, if any are returned, scrape the
 * first one to confirm we can resolve the host's numeric Page id — that id
 * is what we need at import time so each watch row becomes a proper
 * accounts row keyed by numeric account_id (matching what host-attribution
 * during ingest produces).
 *
 * Usage:
 *   deno run --allow-net --allow-env --allow-read --allow-sys \
 *     services/facebook/scripts/smoke-test-watch-list-scrape.ts
 *
 *   --gap-ms=N       Delay between FB calls (default 2500ms; FB rate-limits
 *                    fast public-scrape bursts)
 */

import {
    EventType,
    scrapeFbEventFromFbid,
    scrapeFbEventList,
} from 'npm:facebook-event-scraper@0.2.6';

// ----------------------------------------------------------------------------
// Inputs
// ----------------------------------------------------------------------------

const GAP_MS = Number(
    Deno.args.find((a) => a.startsWith('--gap-ms='))?.slice('--gap-ms='.length) ?? 2500,
);

interface TestCase {
    shape: 'slug' | 'at-slug' | 'profile';
    url: string;
    note?: string;
}

// One representative URL per shape, plus one extra plain-slug sample so we
// have a fair signal that "slug" isn't a one-off lucky scrape.
const CASES: TestCase[] = [
    { shape: 'slug', url: 'https://www.facebook.com/DOHEPhilippines/upcoming_hosted_events' },
    { shape: 'slug', url: 'https://www.facebook.com/gdgcebuorg/upcoming_hosted_events', note: 'known-active GDG' },
    { shape: 'at-slug', url: 'https://www.facebook.com/@digitalmarketingcebu6000/upcoming_hosted_events' },
    { shape: 'profile', url: 'https://www.facebook.com/profile.php?id=61574188777317&sk=upcoming_hosted_events' },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ----------------------------------------------------------------------------
// Run
// ----------------------------------------------------------------------------

interface CaseResult {
    shape: TestCase['shape'];
    url: string;
    listOk: boolean;
    listCount: number;
    listError?: string;
    firstEventId?: string;
    firstEventName?: string;
    detailOk?: boolean;
    detailError?: string;
    hosts?: Array<{ id: string; name: string; type: string; url: string }>;
}

const results: CaseResult[] = [];

for (let i = 0; i < CASES.length; i++) {
    const tc = CASES[i];
    const tag = `[${tc.shape}]`;
    console.log(`\n=== ${tag} ${tc.url}${tc.note ? `  (${tc.note})` : ''} ===`);

    const r: CaseResult = { shape: tc.shape, url: tc.url, listOk: false, listCount: 0 };

    // 1. List upcoming events from the page/profile URL.
    try {
        const list = await scrapeFbEventList(tc.url, EventType.Upcoming);
        r.listOk = true;
        r.listCount = list.length;
        console.log(`  list: ${list.length} upcoming event(s)`);
        for (const ev of list.slice(0, 3)) {
            console.log(`    - ${ev.id}  ${ev.name}  (${ev.date})`);
        }
        if (list.length > 0) {
            r.firstEventId = list[0].id;
            r.firstEventName = list[0].name;
        }
    } catch (err) {
        r.listError = err instanceof Error ? err.message : String(err);
        console.log(`  list FAILED: ${r.listError}`);
    }

    // Polite gap before the detail call.
    if (r.firstEventId) await sleep(GAP_MS);

    // 2. Pull full detail for the first event so we can see who FB lists as
    //    the host(s). That tells us the numeric Page id for this watch row.
    if (r.firstEventId) {
        try {
            const ev = await scrapeFbEventFromFbid(r.firstEventId);
            r.detailOk = true;
            r.hosts = (ev.hosts ?? []).map((h) => ({
                id: String(h.id),
                name: h.name,
                type: h.type,
                url: h.url,
            }));
            console.log(`  detail: ${r.hosts.length} host(s)`);
            for (const h of r.hosts) {
                console.log(`    - ${h.id}  ${h.name}  (${h.type})  ${h.url}`);
            }
        } catch (err) {
            r.detailError = err instanceof Error ? err.message : String(err);
            console.log(`  detail FAILED: ${r.detailError}`);
        }
    }

    results.push(r);

    // Polite gap before the next case.
    if (i < CASES.length - 1) await sleep(GAP_MS);
}

// ----------------------------------------------------------------------------
// Summary
// ----------------------------------------------------------------------------

console.log('\n================ SUMMARY ================');
for (const r of results) {
    const listSummary = r.listOk
        ? `list ok (${r.listCount} ev)`
        : `list FAIL: ${r.listError?.slice(0, 80) ?? 'unknown'}`;
    const detailSummary = r.firstEventId == null
        ? 'detail skipped (no events)'
        : r.detailOk
        ? `detail ok (${r.hosts?.length ?? 0} host(s))`
        : `detail FAIL: ${r.detailError?.slice(0, 80) ?? 'unknown'}`;
    console.log(`  [${r.shape.padEnd(8)}] ${listSummary}  |  ${detailSummary}`);
    if (r.hosts && r.hosts.length > 0) {
        const primary = r.hosts[0];
        console.log(`               primary host → ${primary.id}  ${primary.name}  (${primary.type})`);
    }
}

const anyListFail = results.some((r) => !r.listOk);
const anyDetailFail = results.some((r) => r.firstEventId && !r.detailOk);
console.log('');
if (!anyListFail && !anyDetailFail) {
    console.log('✓ All shapes parsed cleanly. Numeric host ids available — ready to wire the import script.');
    Deno.exit(0);
} else {
    console.log('✗ At least one case failed. Inspect the per-case errors above before moving on.');
    Deno.exit(1);
}
