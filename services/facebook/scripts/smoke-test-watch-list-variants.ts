#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-sys --no-config
/**
 * Follow-up smoke test: for the URL shapes that failed in the first round,
 * try alternative URL forms to figure out whether it's the lib's URL parser
 * being strict or the underlying FB content actually being unavailable.
 *
 *   @-prefixed slug   → also try the slug without the @
 *   /upcoming_hosted_events → also try /events (modern FB path)
 *   profile.php?id=… → also try /<id>/events (canonical numeric form)
 *
 * Usage:
 *   deno run --no-config --allow-net --allow-env --allow-read --allow-sys \
 *     services/facebook/scripts/smoke-test-watch-list-variants.ts
 */

import {
    EventType,
    scrapeFbEventList,
} from 'npm:facebook-event-scraper@0.2.6';

const GAP_MS = 2500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Variant {
    label: string;
    url: string;
}

const groups: Array<{ name: string; variants: Variant[] }> = [
    {
        name: 'gdgcebuorg (plain slug, was "No event data found")',
        variants: [
            { label: 'original', url: 'https://www.facebook.com/gdgcebuorg/upcoming_hosted_events' },
            { label: '/events', url: 'https://www.facebook.com/gdgcebuorg/events' },
        ],
    },
    {
        name: '@digitalmarketingcebu6000 (was "Invalid Facebook page event URL")',
        variants: [
            { label: 'original (@-prefixed)', url: 'https://www.facebook.com/@digitalmarketingcebu6000/upcoming_hosted_events' },
            { label: 'no @', url: 'https://www.facebook.com/digitalmarketingcebu6000/upcoming_hosted_events' },
            { label: 'no @ + /events', url: 'https://www.facebook.com/digitalmarketingcebu6000/events' },
        ],
    },
    {
        name: 'profile.php id=61574188777317 (was "No event data found")',
        variants: [
            { label: 'original (profile.php + sk=)', url: 'https://www.facebook.com/profile.php?id=61574188777317&sk=upcoming_hosted_events' },
            { label: '/<id>/upcoming_hosted_events', url: 'https://www.facebook.com/61574188777317/upcoming_hosted_events' },
            { label: '/<id>/events', url: 'https://www.facebook.com/61574188777317/events' },
        ],
    },
];

let first = true;
for (const g of groups) {
    console.log(`\n=== ${g.name} ===`);
    for (const v of g.variants) {
        if (!first) await sleep(GAP_MS);
        first = false;
        try {
            const list = await scrapeFbEventList(v.url, EventType.Upcoming);
            console.log(`  ${v.label.padEnd(28)} → list ok (${list.length} ev) ${v.url}`);
            for (const ev of list.slice(0, 2)) {
                console.log(`    - ${ev.id}  ${ev.name}  (${ev.date})`);
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.log(`  ${v.label.padEnd(28)} → FAIL: ${msg.slice(0, 90)}  ${v.url}`);
        }
    }
}
