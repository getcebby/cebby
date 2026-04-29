#!/usr/bin/env -S deno run --allow-net --no-config
/**
 * Local smoke-test for the Luma scraper. No DB writes — just fetch and print.
 *
 * The `--no-config` flag skips the ambient services/luma/deno.json which has a
 * workspace-style import-map entry (`@repo/eslint-config/library`) that doesn't
 * resolve outside the deployed environment. Only this probe needs to bypass it.
 *
 * Usage:
 *   deno run --allow-net --no-config services/luma/scripts/probe.ts [<path>] [--event] [--json]
 *
 * Examples:
 *   # List upcoming events for a calendar slug (defaults to "awsugcebu" if omitted)
 *   deno run --allow-net --no-config services/luma/scripts/probe.ts awsugcebu
 *
 *   # User-profile path (uses api2.luma.com under the hood)
 *   deno run --allow-net --no-config services/luma/scripts/probe.ts user/lisksea
 *
 *   # Single event detail
 *   deno run --allow-net --no-config services/luma/scripts/probe.ts --event some-event-slug
 *
 *   # JSON output (pipe to jq, save to a file, etc.)
 *   deno run --allow-net --no-config services/luma/scripts/probe.ts goab --json
 */

import {
    fetchEventsForLumaPath,
    fetchLumaEvent,
    fetchLumaPageData,
    normalizeLumaPath,
} from '../supabase/functions/_shared/lumautils.ts';
import type { LumaEvent } from '../supabase/functions/_shared/types.ts';

const DEFAULT_PATH = 'awsugcebu';

interface Args {
    target: string;
    eventMode: boolean;
    json: boolean;
    raw: boolean;
    help: boolean;
}

function parseArgs(argv: string[]): Args {
    const args: Args = { target: '', eventMode: false, json: false, raw: false, help: false };
    for (const a of argv) {
        if (a === '--help' || a === '-h') args.help = true;
        else if (a === '--event') args.eventMode = true;
        else if (a === '--json') args.json = true;
        else if (a === '--raw') args.raw = true;
        else if (!args.target) args.target = a;
    }
    return args;
}

function printHelp(): void {
    console.log(`Probe the Luma scraper without touching the DB.

Usage:
  deno run --allow-net --no-config services/luma/scripts/probe.ts [<path>] [--event|--raw] [--json]

Args:
  <path>     Calendar slug (e.g. "awsugcebu"), user handle path
             (e.g. "user/lisksea"), or event reference (with --event).
             Default: "${DEFAULT_PATH}"

Flags:
  --event    Treat <path> as a single event reference and print its detail.
  --raw      Dump the raw __NEXT_DATA__.props.pageProps.initialData subtree
             as JSON. Use to diagnose pages where extraction returns nothing.
  --json     Emit JSON instead of the human-readable layout.
  -h, --help Print this help.`);
}

function pickInitialData(nextData: unknown): unknown {
    // Walk the well-known path; fall back to the entire blob if missing.
    const root = nextData as Record<string, unknown> | null;
    const props = (root?.props ?? null) as Record<string, unknown> | null;
    const pageProps = (props?.pageProps ?? null) as Record<string, unknown> | null;
    return pageProps?.initialData ?? nextData;
}

function truncate(s: string | null, n: number): string {
    if (!s) return '';
    const oneLine = s.replace(/\s+/g, ' ').trim();
    return oneLine.length > n ? `${oneLine.slice(0, n - 1)}…` : oneLine;
}

function printEvent(event: LumaEvent, index?: number, total?: number): void {
    const header = index != null && total != null
        ? `[${index + 1}/${total}] ${event.name}`
        : event.name;
    console.log(header);
    console.log(`      api_id: ${event.api_id}`);
    console.log(`      slug:   ${event.slug}`);
    console.log(`      url:    ${event.url}`);
    console.log(`      when:   ${event.start_time}${event.end_time ? ` → ${event.end_time}` : ''}`);
    console.log(`      where:  ${event.location ?? '(none)'}${event.location_type ? ` (${event.location_type})` : ''}`);
    if (event.location_details) {
        console.log(`      coords: ${event.location_details.latitude}, ${event.location_details.longitude}`);
    }
    if (event.cover_photo) console.log(`      cover:  ${event.cover_photo}`);
    if (event.presenter) {
        console.log(
            `      pres:   ${event.presenter.name} (${event.presenter.api_id}) [${event.presenter.kind}]`,
        );
    } else {
        console.log(`      pres:   (none — would skip on ingest)`);
    }
    if (event.hosts.length > 0) {
        const hostList = event.hosts.map((h) => `${h.name} (${h.api_id})`).join(', ');
        console.log(`      hosts:  ${hostList}  ← metadata only, not in event_organizers`);
    }
    if (event.description) console.log(`      desc:   ${truncate(event.description, 120)}`);
    console.log('');
}

async function main(): Promise<void> {
    const args = parseArgs(Deno.args);
    if (args.help) {
        printHelp();
        return;
    }

    const target = args.target || DEFAULT_PATH;
    const normalized = normalizeLumaPath(target);

    if (args.raw) {
        console.error(`[probe] dumping raw __NEXT_DATA__.initialData for: ${normalized}\n`);
        const data = await fetchLumaPageData(normalized);
        if (!data) {
            console.error('[probe] no __NEXT_DATA__ on the page');
            Deno.exit(1);
        }
        console.log(JSON.stringify(pickInitialData(data), null, 2));
        return;
    }

    if (args.eventMode) {
        console.error(`[probe] fetching event: ${normalized}\n`);
        const event = await fetchLumaEvent(normalized);
        if (!event) {
            console.error('[probe] no event found — page may not be a Luma event or __NEXT_DATA__ missing');
            Deno.exit(1);
        }
        if (args.json) {
            console.log(JSON.stringify(event, null, 2));
        } else {
            printEvent(event);
        }
        return;
    }

    console.error(`[probe] listing future events for path: ${normalized}\n`);
    const events = await fetchEventsForLumaPath(normalized);

    if (args.json) {
        console.log(JSON.stringify(events, null, 2));
        return;
    }

    if (events.length === 0) {
        console.log('No future events found.');
        return;
    }

    console.log(`Found ${events.length} future event(s):\n`);
    events.forEach((e, i) => printEvent(e, i, events.length));
}

main().catch((err) => {
    console.error('[probe] fatal:', err instanceof Error ? err.stack ?? err.message : err);
    Deno.exit(1);
});
