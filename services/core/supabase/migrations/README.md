# Cebby v1 → v2 Cutover Runbook

This is the playbook for migrating Cebby from the v1.5 staging Supabase project
(`utbymunzemtumroucqga`) to the clean v2 project (`enwcrupzidbcwimyttla`,
Singapore region). It documents what was done, why, and how to roll back.

The cutover happened **2026-04-29 → 2026-04-30**. This document is the
authoritative reference for re-running the same process against another
environment, or for understanding the current state of v2.

> **Note on folder layout**: during the cutover the v1 `migrations/` folder
> was renamed to `migrations-v1-archive/` (across services/core, services/luma,
> and services/facebook), and the new v2 schema lives in `migrations/` so CI's
> `supabase db push` flow naturally targets v2. Anything below this line that
> says `services/core/supabase/migrations/` refers to the post-rename layout.


## Why we did this

Three reasons:

1. **Schema couldn't keep accreting.** The v1.5 schema was a stack of in-place
   `ALTER TABLE` migrations layered on the original FB-only design. Cleaning up
   meant either fragile incremental migrations or a fresh start. We picked
   fresh.
2. **The data we wanted didn't trust itself.** "Presented by" attribution had
   silent gaps from the n8n era. Re-deriving from re-scrape against a clean
   schema is more reliable than back-patching.
3. **Singapore region.** v1 was on US-East. Cloudflare's PH/SG colos hit
   Singapore Supabase ~5x faster.


## Architecture after cutover

```
┌──────────────────────────────────────────────────────────────────┐
│  Cloudflare Pages (PWA)                                          │
│   Astro 5 + Cloudflare adapter → www.getcebby.com                │
│   Reads via supabase-js → enwcrupzidbcwimyttla.supabase.co       │
└───────────────────────────┬──────────────────────────────────────┘
                            │ HTTPS / PostgREST
┌───────────────────────────▼──────────────────────────────────────┐
│  Supabase v2 project (Singapore — ap-southeast-1)                │
│  • events, accounts, organizations, event_organizers,            │
│    event_source_links, tags, venues, event_slugs, ...            │
│  • Edge Functions: cron-sync-luma-calendars, luma-scraper,       │
│    retrieve-and-sync-to-db-luma-events,                          │
│    cron-sync-facebook-accounts, fb-scraper,                      │
│    retrieve-and-sync-to-db-events                                │
│  • pg_cron: every 6h fans out per-account HTTP calls via pg_net  │
│  • app_secrets: holds internal_fn_jwt for cron auth              │
└───────────────────────────┬──────────────────────────────────────┘
                            │ stores cover photos
┌───────────────────────────▼──────────────────────────────────────┐
│  Cloudflare R2 (cebby-images bucket → images.getcebby.com)       │
│  • events/{slug}.{jpg|png|webp}  — re-hosted at ingest time      │
└──────────────────────────────────────────────────────────────────┘
```


## Phase 1 — Provision v2 (one-time, done)

1. **Create the Supabase project** at supabase.com:
   - Region: Southeast Asia (Singapore)
   - Postgres type: standard (NOT OrioleDB — it's alpha)
   - Take note of project ref, db password, and the **legacy JWT-format**
     anon and service_role keys (Settings → API → "Project API keys" — the
     long `eyJ...` strings, NOT the `sb_publishable_...` ones).
2. **Create the R2 bucket** at Cloudflare:
   - Bucket name: `cebby-images`
   - Public access on (custom domain `images.getcebby.com`)
   - Generate an S3-compatible API token with Object R/W
3. **Fill `services/core/scripts/.env.migration`** with old + new + R2 creds
   (template is committed; values are gitignored).


## Phase 2 — Schema (done)

Apply migrations in order via the v2 project's SQL editor:

1. `services/core/supabase/migrations/20260429000000_v2_initial_schema.sql`
   - Extensions, enum types, all v2 tables, indexes, RLS, seeded tags
2. `services/core/supabase/migrations/20260430000000_ingest_cron.sql`
   - pg_cron + pg_net schedules; `app_secrets` table; `fan_out_account_syncs`
   - Run separately so any failure here doesn't block schema work

Set the internal JWT once after migration:

```sql
INSERT INTO public.app_secrets (name, value, description)
VALUES ('internal_fn_jwt', '<legacy-format-anon-jwt>', 'Bearer used by pg_cron for Edge Function calls')
ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value;
```


## Phase 3 — Data migration (done)

Run `services/core/scripts/migrate-v1-to-v2.ts`:

```bash
deno run --allow-net --allow-env --allow-read --allow-sys --no-config \
  services/core/scripts/migrate-v1-to-v2.ts
```

What it does:

| Step | Source | Target | Notes |
|---|---|---|---|
| `organizations` | v1.5 | v2 | Slug fallback for null v1 slugs |
| `accounts` | v1.5 | v2 | `account_details.path` → `discovery_path` (typed column) |
| `account_secrets` | v1.5 (split) | v2 | Tokens split off `accounts` for tighter RLS |
| `events` | v1.5 | v2 | `is_hidden` → `status` enum; legacy columns dropped; format derived from location |
| Cover photos | v1.5 / lumacdn / fbcdn | R2 | Fetched + uploaded with bounded concurrency |
| `event_source_links` | v1.5 | v2 | `ingest_kind` defaults to `public_scrape` |
| `events.primary_source_link_id` | v1.5 | v2 | Deferred set after links exist |
| `event_organizers`, `event_slugs` | v1.5 | v2 | Verbatim |
| `profiles`, `event_registrations` | v1.5 | v2 | Verbatim (dormant tables) |

After it completes, run the printed sequence-reset SQL in the v2 SQL editor.

**Idempotent**: re-running upserts on natural keys, never duplicates.


## Phase 4 — Edge Function deployment (done)

Deploy each service's functions to v2. Requires `SUPABASE_ACCESS_TOKEN` from
the CebbyORG account (Personal Access Token at
https://supabase.com/dashboard/account/tokens).

```bash
PAT=<personal-access-token>

# Deploy Luma functions
cd services/luma
SUPABASE_ACCESS_TOKEN=$PAT npx supabase functions deploy --project-ref enwcrupzidbcwimyttla

# Deploy Facebook functions
cd services/facebook
SUPABASE_ACCESS_TOKEN=$PAT npx supabase functions deploy --project-ref enwcrupzidbcwimyttla
```

Set Edge Function secrets:

```bash
# create a temp env file with the public-cron-runtime secrets
TMP=$(mktemp)
cat <<EOF > "$TMP"
GOOGLE_MAPS_KEY=<key>
R2_ACCOUNT_ID=<id>
R2_ACCESS_KEY_ID=<id>
R2_SECRET_ACCESS_KEY=<key>
R2_BUCKET=cebby-images
R2_PUBLIC_URL=https://images.getcebby.com
INTERNAL_FN_JWT=<legacy-format-anon-jwt>
EOF
SUPABASE_ACCESS_TOKEN=$PAT npx supabase secrets set --env-file "$TMP" --project-ref enwcrupzidbcwimyttla
rm "$TMP"
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` are
auto-injected by Supabase. **Do not** rely on them for function-to-function
auth — Supabase's new key system injects them in `sb_publishable_` /
`sb_secret_` format which the Edge Function JWT verifier rejects. Hence
`INTERNAL_FN_JWT` (legacy JWT) for inter-function calls.


## Phase 5 — Cron activation (done)

The `20260430000000_ingest_cron.sql` migration installs two schedules:

- `sync-luma-accounts` — every 6h on the hour (`0 */6 * * *`)
- `sync-fb-accounts` — every 6h offset by 30 min (`30 */6 * * *`)

Both call `public.fan_out_account_syncs(type, fn_url)` which iterates active
accounts of the given type and POSTs each row to the per-account function via
`net.http_post`. Async — pg_net handles delivery and retries.

Verify with:

```sql
-- See the next-fire schedule
SELECT jobname, schedule, command FROM cron.job WHERE jobname LIKE 'sync-%';

-- After a fan-out runs, check responses
SELECT * FROM public.recent_ingest_calls LIMIT 20;
```

To trigger manually instead of waiting for the schedule:

```sql
SELECT public.fan_out_account_syncs(
    'luma',
    'https://enwcrupzidbcwimyttla.supabase.co/functions/v1/retrieve-and-sync-to-db-luma-events'
);
```


## Phase 6 — PWA code adjustments (done)

Files updated to use v2 schema:

| File | Change |
|---|---|
| `apps/pwa/src/scripts/sync-typesense-standalone.ts` | `is_hidden` → `status`; legacy FK join → `event_organizers` join |
| `apps/pwa/src/pages/calendar.astro` | `is_hidden` → `status` |
| `apps/pwa/src/pages/sitemap.xml.ts` | `is_hidden` → `status` |
| `apps/pwa/src/pages/api/events-data.ts` | `is_hidden` → `status` |
| `apps/pwa/src/pages/api/calendar.ts` | `is_hidden` → `status`; `event.source_id` URL → `event_source_links.url` fallback to `getcebby.com/events/...` |
| `apps/pwa/src/pages/api/test-enable-rsvp.ts` | `is_hidden`/`registration_enabled` writes → `status` only (dormant endpoint) |
| `apps/pwa/src/pages/index.astro` | `is_hidden` → `status` (×2) |
| `apps/pwa/src/pages/venues/[slug].astro` | `is_hidden` → `status` |
| `apps/pwa/src/pages/partners.astro` | Event count via `event_organizers` (dropped `events.account_id` legacy FK) |
| `apps/pwa/src/pages/events/[slug].astro` | `is_hidden` → `status`; legacy FB URL fallback → canonical-source URL |
| `apps/pwa/src/components/RsvpButton.astro` | Reads via `getCanonicalSource(event)` instead of `event.source_id`/`source`/`ticket_url` |

The `event-attribution.ts` helper still has fallback paths to `event.source` /
`event.ticket_url` for events lacking source_links — defensive. Will be dead
code after a few cron cycles (every event will have at least one source_link
once re-scraped), but kept for safety during the transition.


## Phase 7 — PWA env flip (done)

`apps/pwa/.env` updated:

```
# Active: v2 (Singapore)
PUBLIC_SUPABASE_URL=https://enwcrupzidbcwimyttla.supabase.co
PUBLIC_SUPABASE_ANON_KEY=<legacy JWT format — eyJ...>
SUPABASE_SERVICE_ROLE_KEY=<legacy JWT format — eyJ...>
DB_PASSWORD=<v2 db password>
```

The `sb_publishable_...` and `sb_secret_...` formats Supabase auto-generates
DON'T pass the JWT verifier on the Edge Function endpoint. Always use the
`eyJ...` JWT-format keys for Cebby — they're what `supabase-js` and our
internal cron auth both accept.

Previous environments are commented out in the file for rollback reference.


## Phase 8 — Deploy & verify (in progress / pending)

After local smoke-test (`pnpm --filter pwa dev`):

1. Verify rendered HTML: cover photos point at `images.getcebby.com`, no
   broken events, partner page renders
2. Push to main → Cloudflare Pages auto-deploys (already wired up)
3. Verify production by hitting `www.getcebby.com`
4. Check `recent_ingest_calls` view in v2 over the next 24h to confirm cron is
   firing as expected


## Rollback

If anything goes wrong on production deploy:

1. **Revert PWA**: in `apps/pwa/.env`, swap the active block back to `v1.5
   STAGING` (it's the previous commented-out block). Re-deploy.
2. **Re-enable v1.5 cron** if it was paused (see "Decommissioning v1.5"
   below). Otherwise v1.5 cron has been running this whole time anyway.
3. **Tell users**: nothing — the rollback is invisible since v1.5 has all the
   same data minus what was added to v2 in the gap.

Total time to roll back: ~5 minutes (one env edit + Cloudflare Pages deploy).


## Decommissioning v1.5 (when ready, NOT yet)

Don't do this for ~2 weeks after cutover. Until then, v1.5 is the rollback
safety net AND the source of partner-logo images that the v2 PWA still
references.

When confident v2 is stable:

1. **Stop v1.5 cron** so it doesn't continue scraping into a dead-end project:
   ```sql
   -- in the v1.5 SQL editor
   UPDATE cron.job SET active = false WHERE jobname LIKE 'cron-sync-%';
   ```
2. **Migrate partner logos** to R2 (one-time script, write later) so the v2
   PWA stops referencing v1's Supabase Storage.
3. **Pause or delete v1.5 project** in the dashboard.


## Known issues / open items

| Item | Severity | Notes |
|---|---|---|
| Partner-logo URLs reference v1 production Supabase Storage (`qkhlgxdtodyyemkarouo.supabase.co/storage/...`) | Low | Logos load fine; will break if v1 production is deleted. Migrate them to R2 in a follow-up. |
| FB Graph "API access disrupted" — needs Data Use Checkup at developers.facebook.com app `520608954016953` | Med | Partnership cron returns 401 until checkup is completed. No-token strategy still runs. |
| `database.types.ts` is empty/stale — `astro check` reports ~127 type errors | Low | Pre-existing; runtime works. Regenerate via `supabase gen types typescript --project-id enwcrupzidbcwimyttla > services/core/supabase/shared/database.types.ts` once we want clean type-check. |
| Stale FB CDN URLs from old scrapes (oe= timestamps from 2024-12) failed to re-host to R2 (~18 events) | Low | Those events have `cover_photo = NULL`; PWA shows placeholder. Re-scrape will fill if FB re-issues fresh URLs. |
| Edge Function `verify_jwt` middleware rejects new-format Supabase keys | Worked around | We use `INTERNAL_FN_JWT` (legacy JWT) as a custom secret for cron auth. Long-term: monitor Supabase docs for when the new keys become first-class for Edge Functions. |


## File map (committed reference for everything)

| Path | Role |
|---|---|
| `services/core/supabase/migrations/20260429000000_v2_initial_schema.sql` | Full v2 schema |
| `services/core/supabase/migrations/20260430000000_ingest_cron.sql` | pg_cron + pg_net + secrets |
| `services/core/supabase/migrations/README.md` | This document |
| `services/core/scripts/.env.migration` | Migration credentials (gitignored) |
| `services/core/scripts/migrate-v1-to-v2.ts` | The v1→v2 data migration (Deno) |
| `services/luma/scripts/test-ingest-v2.ts` | Local end-to-end test for Luma ingest |
| `services/luma/scripts/probe.ts` | Stateless Luma scraper smoke-test |
| `services/facebook/scripts/test-ingest-v2.ts` | Local test for FB Graph (partnership) ingest |
| `services/facebook/scripts/test-scraper-v2.ts` | Local test for FB no-token (public_scrape) ingest |
