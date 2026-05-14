#!/usr/bin/env -S deno run --no-config --allow-net --allow-env --allow-read --allow-sys
/**
 * Cleanup: remove events ingested from FB watch-list scrapes where the
 * watched page was NOT actually a host — the listing-vs-host gap that
 * the host-membership guard now prevents going forward.
 *
 * What "bad" means here: an event whose only organizers are FB numeric-id
 * accounts AND none of those accounts has a discovery_path matching one
 * of our explicit watch slugs. (I.e. nothing currently connects the event
 * back to a deliberately-added watch target.)
 *
 * Removes per event: event_organizers → event_source_links → event_slugs →
 * events. Also deactivates the auto-created cohost-stub host accounts that
 * have no discovery_path (so they don't sit as zombie public_scrape rows).
 *
 * Usage:
 *   deno run --no-config --allow-net --allow-env --allow-read --allow-sys \
 *     services/facebook/scripts/cleanup-bad-watch-ingests.ts
 *
 *     --apply           Actually delete. Otherwise dry-run only.
 *     --since=ISO       Only consider source-links with scraped_at >= this
 *                       (default 2026-05-14T13:42:00+00:00, the batch tick).
 */

import { load } from 'jsr:@std/dotenv@0.225';
import { createClient } from 'npm:@supabase/supabase-js@2';

const env = await load({ envPath: '/Users/dorelljames/Projects/cebby/services/core/scripts/.env.migration', export: false });
const sb = createClient(env.NEW_SUPABASE_URL!, env.NEW_SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const APPLY = Deno.args.includes('--apply');
const SINCE = Deno.args.find((a) => a.startsWith('--since='))?.slice('--since='.length)
    ?? '2026-05-14T13:42:00+00:00';

// Explicit watch entries — slug-keyed account_ids we deliberately imported,
// plus their discovery_path slugs (same set here since they match).
const WATCH_SLUGS = new Set([
    'DOHEPhilippines','TheCompanyCebu','dostcebu','DICTr7','cebumicrosofttechusersgroup',
    'notion.cebu','CebUXD','gdgcebuorg','AIPilipinasCebu','digitalmarketingcebu6000',
    'UniversalTechExpo','spinvirtualsolutions','eccpcebu','NewsCebu','CebuGameDev','theframecommunity',
    '61574188777317',
]);

console.log(`mode: ${APPLY ? 'APPLY (will delete)' : 'DRY-RUN'}  since: ${SINCE}\n`);

// 1. Pull recent public_scrape FB source-links.
const { data: links } = await sb
    .from('event_source_links')
    .select('id, event_id, source_id, scraped_at')
    .eq('source', 'facebook')
    .eq('ingest_kind', 'public_scrape')
    .gte('scraped_at', SINCE)
    .order('scraped_at', { ascending: true });

if (!links || links.length === 0) {
    console.log('Nothing to consider since cutoff.');
    Deno.exit(0);
}

// 2. Classify each as ours / not-ours.
interface BadEvent {
    eventId: number;
    sourceLinkId: number;
    sourceFbId: string;
    name: string | null;
    orgIds: string[];
}
const badEvents: BadEvent[] = [];

for (const l of links) {
    const { data: ev } = await sb.from('events').select('id, name').eq('id', l.event_id).maybeSingle();
    const { data: orgs } = await sb.from('event_organizers').select('account_id').eq('event_id', l.event_id);
    const orgIds = (orgs ?? []).map((o: { account_id: string }) => o.account_id);

    let dps: string[] = [];
    if (orgIds.length > 0) {
        const { data: accs } = await sb.from('accounts').select('discovery_path').in('account_id', orgIds);
        dps = (accs ?? []).map((a: { discovery_path: string | null }) => a.discovery_path).filter(Boolean) as string[];
    }
    const isOurs = orgIds.some((id) => WATCH_SLUGS.has(id)) || dps.some((dp) => WATCH_SLUGS.has(dp));
    if (!isOurs) {
        badEvents.push({
            eventId: l.event_id,
            sourceLinkId: l.id,
            sourceFbId: l.source_id,
            name: ev?.name ?? null,
            orgIds,
        });
    }
}

if (badEvents.length === 0) {
    console.log('No bad ingests found in window. Nothing to clean up.');
    Deno.exit(0);
}

console.log(`Bad events to remove (${badEvents.length}):`);
for (const b of badEvents) {
    console.log(`  ev=${b.eventId} fb=${b.sourceFbId} "${(b.name ?? '').slice(0, 70)}"  orgs=[${b.orgIds.join(',')}]`);
}

// 3. Auto-created host accounts that don't have a discovery_path — cohost
//    stubs we'd like to deactivate so the cron doesn't keep them around as
//    pretend watch targets. We exclude accounts that DO have discovery_path
//    (those are legit watch rows or reconciled numeric rows).
const allOrgIds = Array.from(new Set(badEvents.flatMap((b) => b.orgIds)));
const { data: stubAccs } = await sb
    .from('accounts')
    .select('account_id, name, discovery_path, is_active')
    .in('account_id', allOrgIds);
const stubsToDeactivate = (stubAccs ?? [])
    .filter((a: { discovery_path: string | null; is_active: boolean }) => !a.discovery_path && a.is_active)
    .map((a: { account_id: string; name: string }) => a);

if (stubsToDeactivate.length > 0) {
    console.log(`\nCohost-stub accounts to deactivate (${stubsToDeactivate.length}):`);
    for (const s of stubsToDeactivate as Array<{ account_id: string; name: string }>) {
        console.log(`  ${s.account_id}  "${s.name}"`);
    }
}

if (!APPLY) {
    console.log('\nDry-run finished. Re-run with --apply to delete.');
    Deno.exit(0);
}

// 4. Apply — order matters because of FK refs.
const eventIds = badEvents.map((b) => b.eventId);

console.log('\nDeleting event_organizers ...');
const { error: orgErr, count: orgCount } = await sb
    .from('event_organizers').delete({ count: 'exact' }).in('event_id', eventIds);
if (orgErr) { console.error('  ✗', orgErr.message); Deno.exit(1); }
console.log(`  ✓ ${orgCount ?? 0} rows`);

console.log('Deleting event_source_links ...');
const { error: linkErr, count: linkCount } = await sb
    .from('event_source_links').delete({ count: 'exact' }).in('event_id', eventIds);
if (linkErr) { console.error('  ✗', linkErr.message); Deno.exit(1); }
console.log(`  ✓ ${linkCount ?? 0} rows`);

// event_slugs may not exist on every project — try, ignore "relation not found".
console.log('Deleting event_slugs ...');
const { error: slugErr, count: slugCount } = await sb
    .from('event_slugs').delete({ count: 'exact' }).in('event_id', eventIds);
if (slugErr && !/relation .*event_slugs.* does not exist/i.test(slugErr.message)) {
    console.error('  ✗', slugErr.message); Deno.exit(1);
}
console.log(`  ✓ ${slugCount ?? 0} rows`);

console.log('Deleting events ...');
const { error: evErr, count: evCount } = await sb
    .from('events').delete({ count: 'exact' }).in('id', eventIds);
if (evErr) { console.error('  ✗', evErr.message); Deno.exit(1); }
console.log(`  ✓ ${evCount ?? 0} rows`);

if (stubsToDeactivate.length > 0) {
    console.log('Deactivating cohost-stub accounts ...');
    const stubIds = (stubsToDeactivate as Array<{ account_id: string }>).map((s) => s.account_id);
    const { error: deactErr, count: deactCount } = await sb
        .from('accounts').update({ is_active: false }, { count: 'exact' }).in('account_id', stubIds);
    if (deactErr) { console.error('  ✗', deactErr.message); Deno.exit(1); }
    console.log(`  ✓ ${deactCount ?? 0} rows`);
}

console.log('\nCleanup complete.');
