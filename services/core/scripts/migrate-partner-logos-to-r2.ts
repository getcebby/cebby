#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-sys --no-config
/**
 * Move the 16 hand-curated partner logos off v1 prod Supabase Storage and
 * onto Cloudflare R2 (cebby-images bucket). Update accounts.primary_photo
 * in the v2 db to point at the new R2 URLs.
 *
 * Why now: v1 prod (qkhlgxdtodyyemkarouo) is being decommissioned soon. The
 * 16 partner logos referenced from v2 break the moment v1 is paused. Moving
 * them to the same R2 bucket that already holds event covers (under a
 * `partners/` prefix) makes v2 self-contained.
 *
 * Reads `services/core/scripts/.env.migration` for:
 *   NEW_SUPABASE_URL
 *   NEW_SUPABASE_SERVICE_ROLE_KEY
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_URL
 *
 * Idempotent: re-runs skip accounts whose primary_photo is already on R2
 * (or no longer matches the v1 storage pattern). Safe to run repeatedly.
 *
 * Usage:
 *   deno run --allow-net --allow-env --allow-read --allow-sys --no-config \
 *     services/core/scripts/migrate-partner-logos-to-r2.ts [--dry-run]
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import { PutObjectCommand, S3Client } from 'npm:@aws-sdk/client-s3@3';
import { load } from 'jsr:@std/dotenv@0.225';

const ENV_PATH = new URL('./.env.migration', import.meta.url).pathname;
const env = await load({ envPath: ENV_PATH, export: false });

function need(key: string): string {
    const v = Deno.env.get(key) ?? env[key];
    if (!v) {
        console.error(`✗ Missing required env var: ${key}  (file: ${ENV_PATH})`);
        Deno.exit(1);
    }
    return v;
}

const DRY_RUN = Deno.args.includes('--dry-run');

const NEW_URL = need('NEW_SUPABASE_URL');
const NEW_KEY = need('NEW_SUPABASE_SERVICE_ROLE_KEY');

const R2_ACCOUNT_ID        = need('R2_ACCOUNT_ID');
const R2_ACCESS_KEY_ID     = need('R2_ACCESS_KEY_ID');
const R2_SECRET_ACCESS_KEY = need('R2_SECRET_ACCESS_KEY');
const R2_BUCKET            = need('R2_BUCKET');
const R2_PUBLIC_URL        = need('R2_PUBLIC_URL').replace(/\/+$/, '');

const supabase = createClient(NEW_URL, NEW_KEY, { auth: { persistSession: false } });
const r2 = new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
});

const FETCH_HEADERS = {
    'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Accept': 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8,*/*;q=0.5',
};

interface Row {
    account_id: string;
    name: string;
    primary_photo: string | null;
}

const V1_PATTERN = 'https://qkhlgxdtodyyemkarouo.supabase.co/storage/';

function basenameFromUrl(url: string): string {
    // Last path segment, ignoring querystring/fragment.
    const path = url.split('?')[0].split('#')[0];
    return path.split('/').filter(Boolean).pop() ?? '';
}

function extFromContentType(ct: string): string {
    const m = ct.match(/image\/([a-z0-9]+)/i);
    if (!m) return 'jpg';
    const e = m[1].toLowerCase();
    return e === 'jpeg' ? 'jpg' : e;
}

async function fetchImage(url: string): Promise<{ bytes: Uint8Array; contentType: string } | null> {
    try {
        const res = await fetch(url, { redirect: 'follow', headers: FETCH_HEADERS });
        if (!res.ok) {
            console.warn(`  ⚠ fetch ${url} → HTTP ${res.status}`);
            return null;
        }
        const contentType = res.headers.get('content-type') ?? '';
        if (!contentType.toLowerCase().startsWith('image/')) {
            console.warn(`  ⚠ non-image content-type "${contentType}" — skipping`);
            return null;
        }
        const bytes = new Uint8Array(await res.arrayBuffer());
        return { bytes, contentType };
    } catch (err) {
        console.warn(`  ⚠ fetch error: ${err instanceof Error ? err.message : err}`);
        return null;
    }
}

async function migrateOne(row: Row): Promise<'migrated' | 'skipped' | 'failed'> {
    if (!row.primary_photo) return 'skipped';
    if (!row.primary_photo.startsWith(V1_PATTERN)) {
        // Already migrated (R2) or never on v1 storage.
        return 'skipped';
    }

    const oldBasename = basenameFromUrl(row.primary_photo);
    if (!oldBasename) {
        console.warn(`  ⚠ could not parse basename from ${row.primary_photo}`);
        return 'failed';
    }

    console.log(`  → ${row.name}  (${oldBasename})`);

    const fetched = await fetchImage(row.primary_photo);
    if (!fetched) return 'failed';

    // Preserve the v1 basename; normalize the extension to match the actual
    // bytes content-type (handles cases where a .png was actually serving
    // image/jpeg, etc.). Fall back to the original extension if nothing
    // recognizable comes back.
    const stem = oldBasename.replace(/\.[^.]+$/, '');
    const ext = extFromContentType(fetched.contentType);
    const objectKey = `partners/${stem}.${ext}`;
    const newUrl = `${R2_PUBLIC_URL}/${objectKey}`;

    if (DRY_RUN) {
        console.log(`    DRY: would upload ${fetched.bytes.length}B → ${objectKey}`);
        console.log(`    DRY: would update accounts.primary_photo → ${newUrl}`);
        return 'migrated';
    }

    try {
        await r2.send(new PutObjectCommand({
            Bucket: R2_BUCKET,
            Key: objectKey,
            Body: fetched.bytes,
            ContentType: fetched.contentType,
            CacheControl: 'public, max-age=31536000, immutable',
        }));
    } catch (err) {
        console.warn(`  ⚠ R2 upload failed: ${err instanceof Error ? err.message : err}`);
        return 'failed';
    }

    const { error } = await supabase
        .from('accounts')
        .update({ primary_photo: newUrl })
        .eq('account_id', row.account_id);
    if (error) {
        console.warn(`  ⚠ db update failed: ${error.message}`);
        return 'failed';
    }

    console.log(`    ✓ ${objectKey}  (${fetched.bytes.length}B)`);
    return 'migrated';
}

async function main() {
    console.log(`mode:    ${DRY_RUN ? 'DRY RUN — no writes' : 'LIVE'}`);
    console.log(`v2:      ${NEW_URL}`);
    console.log(`R2:      ${R2_PUBLIC_URL}  (bucket: ${R2_BUCKET})`);
    console.log('');

    const { data, error } = await supabase
        .from('accounts')
        .select('account_id, name, primary_photo')
        .like('primary_photo', `${V1_PATTERN}%`)
        .order('name', { ascending: true });

    if (error) {
        console.error(`✗ query failed: ${error.message}`);
        Deno.exit(1);
    }
    const rows = (data ?? []) as Row[];
    console.log(`found ${rows.length} account(s) with v1-storage primary_photo\n`);

    let migrated = 0;
    let skipped = 0;
    let failed = 0;
    for (const row of rows) {
        const result = await migrateOne(row);
        if (result === 'migrated') migrated++;
        else if (result === 'skipped') skipped++;
        else failed++;
    }

    console.log('');
    console.log(`done — migrated=${migrated}  skipped=${skipped}  failed=${failed}`);
    if (DRY_RUN) console.log('(dry run — no writes performed; re-run without --dry-run to apply)');
}

main().catch((err) => {
    console.error('fatal:', err instanceof Error ? err.stack ?? err.message : err);
    Deno.exit(1);
});
