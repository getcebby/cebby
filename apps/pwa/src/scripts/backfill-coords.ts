/**
 * Backfill `events.location_details` for rows missing coordinates.
 *
 * Reads `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` from env, geocodes the
 * `events.location` string via Google Geocoding, validates the result is
 * inside the Cebu bounding box (avoids the Tuvalu-coords-for-"Online" bug),
 * and writes back `{ latitude, longitude }` to `location_details`.
 *
 * Usage:
 *   pnpm backfill-coords                  # backfill all null rows
 *   pnpm backfill-coords -- --dry-run     # preview, don't write
 *   pnpm backfill-coords -- --limit 20    # only process 20 rows
 *   pnpm backfill-coords -- --force       # also re-geocode rows that already have coords
 *
 * Switch DB target by changing SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in env.
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { geocodeLocation, looksLikeOnlineEvent } from '@service/core/supabase/shared/geocode.ts';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GOOGLE_MAPS_KEY = process.env.GOOGLE_MAPS_KEY || process.env.PUBLIC_GOOGLE_MAPS_KEY;

if (!SUPABASE_URL) throw new Error('SUPABASE_URL is required');
if (!SUPABASE_SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');
if (!GOOGLE_MAPS_KEY) throw new Error('PUBLIC_GOOGLE_MAPS_KEY is required (Geocoding API must be enabled)');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const FORCE = args.includes('--force');
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx >= 0 ? parseInt(args[limitIdx + 1] ?? '0', 10) || undefined : undefined;
const idsIdx = args.indexOf('--ids');
const IDS = idsIdx >= 0 ? (args[idsIdx + 1] ?? '').split(',').map((s) => s.trim()).filter(Boolean) : null;

// Throttle: Google's free Geocoding tier allows 50 QPS, but be polite.
const QPS = 8;
const MIN_DELAY_MS = Math.ceil(1000 / QPS);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
    console.log('🗺  Backfill events.location_details');
    console.log(`   target: ${SUPABASE_URL}`);
    console.log(`   mode:   ${DRY_RUN ? 'DRY RUN (no writes)' : 'WRITE'}${FORCE ? ' · FORCE re-geocode' : ''}`);
    if (LIMIT) console.log(`   limit:  ${LIMIT}`);
    console.log('');

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_KEY!, {
        auth: { persistSession: false },
    });

    let query = supabase
        .from('events')
        .select('id, location, location_details')
        .not('location', 'is', null)
        .neq('location', '')
        .order('id', { ascending: true });

    if (IDS && IDS.length > 0) query = query.in('id', IDS);
    else if (!FORCE) query = query.is('location_details', null);
    if (LIMIT) query = query.limit(LIMIT);

    const { data: events, error } = await query;
    if (error) {
        console.error('❌ failed to fetch events:', error.message);
        process.exit(1);
    }
    if (!events?.length) {
        console.log('✓ nothing to backfill — all rows already have location_details');
        return;
    }

    console.log(`Found ${events.length} event${events.length === 1 ? '' : 's'} to process\n`);

    const stats = { ok: 0, skipped_online: 0, skipped_already: 0, failed: 0 };
    const failures: { id: string | number; location: string; reason: string }[] = [];

    let i = 0;
    for (const event of events) {
        i++;
        const prefix = `[${i.toString().padStart(events.length.toString().length)}/${events.length}]`;
        const loc = event.location ?? '';

        if (looksLikeOnlineEvent(loc)) {
            console.log(`${prefix} ⊘ skip online: ${loc.slice(0, 60)}`);
            stats.skipped_online++;
            continue;
        }
        if (!FORCE && event.location_details) {
            console.log(`${prefix} ⊘ already has coords: id=${event.id}`);
            stats.skipped_already++;
            continue;
        }

        const tStart = Date.now();
        const result = await geocodeLocation(loc, GOOGLE_MAPS_KEY!);

        if (!result.ok) {
            console.log(`${prefix} ✗ ${result.reason.padEnd(36)} ← ${loc.slice(0, 60)}`);
            failures.push({ id: event.id, location: loc, reason: result.reason });
            stats.failed++;
        } else {
            const coords = `${result.lat.toFixed(5)}, ${result.lng.toFixed(5)}`;
            console.log(`${prefix} ✓ ${coords.padEnd(36)} ← ${loc.slice(0, 60)}`);
            stats.ok++;

            if (!DRY_RUN) {
                const { error: updateError } = await supabase
                    .from('events')
                    .update({ location_details: { latitude: result.lat, longitude: result.lng } })
                    .eq('id', event.id);
                if (updateError) {
                    console.log(`   ⚠ write failed: ${updateError.message}`);
                    failures.push({ id: event.id, location: loc, reason: `write: ${updateError.message}` });
                }
            }
        }

        const elapsed = Date.now() - tStart;
        if (elapsed < MIN_DELAY_MS) await sleep(MIN_DELAY_MS - elapsed);
    }

    console.log('\n— Summary —');
    console.log(`  geocoded:        ${stats.ok}`);
    console.log(`  skipped (online): ${stats.skipped_online}`);
    if (stats.skipped_already) console.log(`  skipped (had coords): ${stats.skipped_already}`);
    console.log(`  failed:          ${stats.failed}`);
    if (DRY_RUN) console.log('\n(dry run — no writes were performed)');

    if (failures.length) {
        console.log('\nFailures:');
        for (const f of failures.slice(0, 20)) {
            console.log(`  id=${f.id}  ${f.reason}  ← ${f.location.slice(0, 80)}`);
        }
        if (failures.length > 20) console.log(`  …and ${failures.length - 20} more`);
    }
}

main().catch((err) => {
    console.error('💥 unhandled error:', err);
    process.exit(1);
});
