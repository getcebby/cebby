# Eventbrite Finding New Events Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every 6 hours, read each watched Eventbrite organizer, import its Cebu events (and online ones from Cebu-based organizers), and show the result as a real Eventbrite "Finding new events" line on `/status`.

**Architecture:**
- **Core:** a pure Cebu rule in `services/core` decides whether an event's place counts.
- **Eventbrite:** three new `_shared` modules call Eventbrite's keyless endpoints, choose which event dates to import, and run one organizer's sync. The stub cron handler becomes a thin wrapper, and the link importer and discovery share one import function.
- **SQL:** one migration adds `accounts.is_cebu_based`, makes the Eventbrite finding line real and schedules the cron.
- **Apps:** the admin app gets an Eventbrite watch form and settings. The PWA gets a "What Cebby lists" section.

**Tech Stack:** Deno edge functions (Supabase), Postgres/pgTAP (Supabase CLI 3.0.0), Astro admin app (vitest), Astro PWA.

**Spec:** `docs/superpowers/specs/2026-11-05-eventbrite-finding-design.md` (approved by Dorell 2026-11-05). The spec's "Evidence" section has the endpoint responses this plan relies on.

## Global Constraints

- **Worktree:** `/Users/dorelljames/Projects/cebby-eventbrite-finding`, branch `feat/eventbrite-finding`. Don't touch `/Users/dorelljames/Projects/cebby`; another session uses it.
- **Supabase CLI is `npx -y supabase@3.0.0`, exactly.**
  - Local DB: `cd services/core && SUPABASE_DB_SEED_ENABLED=false npx -y supabase@3.0.0 db start`.
  - pgTAP: `npx -y supabase@3.0.0 test db`.
  - Reload a migration by hand: `docker exec -i supabase_db_service psql -v ON_ERROR_STOP=1 -U postgres -d postgres -q < file`. `db query --local -f` rejects files with more than one statement.
- **Production is read-only for this work.** Never invoke any Eventbrite function or `private.run_link_checks()` against production. Read-only checks go through `npx -y supabase@3.0.0 db query --remote --read-only` from `/Users/dorelljames/Projects/cebby/services/core`; the worktree isn't linked.
- **Migration file:** `services/core/supabase/migrations/20261105010000_eventbrite_finding.sql`. Production's latest is `20261104020000`; re-check `origin/main` before merge.
- **SQL house rules:**
  - Never `REVOKE EXECUTE` on a `public` function.
  - Internal functions stay in `private`.
  - The column lists of `public.get_scraper_status()` and `public.get_scraper_history()` don't change.
- **No counts on `/status` or its anon RPCs.**
- **Fixed values from the spec:**
  - column `accounts.is_cebu_based boolean NOT NULL DEFAULT false`;
  - cron job `sync-eventbrite-accounts` at `45 */6 * * *`;
  - a series' first **2** dates within **60** days; one-off events have no date limit;
  - online events from a Cebu-based organizer get `city 'Cebu City'`, `region 'Central Visayas'`, `country 'Philippines'` (Luma's values in production).
- **Eventbrite endpoints (exact):**
  - E1: `https://www.eventbrite.com/organizer-profile/api/organizers/{id}/events/?page={n}&pageSize=50`
  - E2: `https://www.eventbrite.com/api/v3/organizers/{id}/`
  - E3: `https://www.eventbrite.com/api/v3/events/{id}/`
  - E4: `https://www.eventbrite.com/api/v3/series/{id}/events/?time_filter=current_future`
  - Send the same `User-Agent` as `HTML_HEADERS` in `_shared/eventbriteutils.ts`, with `Accept: application/json`.
- **Test commands:**
  - Core: `cd services/core && deno test --no-config --node-modules-dir=none --no-lock tests/<file>`.
  - Eventbrite: `cd services/eventbrite && deno test --no-config --node-modules-dir=none --no-lock --allow-read=tests/fixtures --import-map=supabase/functions/import_map.json tests/`.
  - Admin: `PATH="$HOME/Library/pnpm:$PATH" pnpm --filter @cebby/admin test`.
  - PWA build: `PATH="$HOME/Library/pnpm:$PATH" pnpm --filter pwa build`.
- **Commits:** subject imperative, about 50 characters, conventional prefix. Body: one line per paragraph. No AI attribution.

## Review Focus

1. **Same-named towns elsewhere in the Philippines** must not count as Cebu: Naga City (Camarines Sur), Talisay (Negros Occidental, Batangas), Danao (Bohol), Compostela (Davao de Oro). Test in Task 1.
2. **A series date whose own venue is outside Cebu** must be skipped at import, even though its parent qualified. Test in Task 5.
3. **Eventbrite answering `200` with an HTML page** (a bot wall or an error page) must be unread `unexpected_page`, never "read, zero events". Test in Task 3.
4. **`hasMore` that never turns false** must stop at the page cap and still count as read. Test in Task 3.
5. **One failed import of one event** must not mark the organizer unread, and must still leave a warning row. Test in Task 5.

---

### Task 1: The shared Cebu rule (core)

**Files:**
- Create: `services/core/supabase/shared/cebu-rule.ts`
- Modify: `services/core/supabase/shared/search-doc.ts`. Move `OTHER_CITIES`, `CEBU_CITY_AREAS` and `matchCity` out (lines 85–118) and import `matchCebuCity` back.
- Test: `services/core/tests/cebu_rule_test.ts`

**Interfaces:**
- Produces:
  - `export interface PhysicalPlace { city: string | null; region: string | null; country: string | null; address: string | null }`
  - `export type EventPlace = { online: true } | ({ online: false } & PhysicalPlace)`
  - `export function matchCebuCity(text: string | null | undefined): string | null`: the moved `matchCity`, behaviour unchanged.
  - `export function isInCebu(place: PhysicalPlace): boolean`
  - `export function countsForCebby(place: EventPlace, accountIsCebuBased: boolean): boolean`

- [ ] **Step 1: Write the failing tests** in `cebu_rule_test.ts` (`jsr:@std/testing/bdd`, `jsr:@std/expect`, as in `tests/health_checks_test.ts`):
  - `countsForCebby` across the decision table:
    - physical Cebu with a Cebu-based account → `true`; with another account → `true`;
    - `{online:true}` with a Cebu-based account → `true`; with another account → `false`;
    - physical Makati (`city 'Makati City', region 'Metro Manila', country 'PH'`) → `false` for both.
  - `isInCebu`:
    - `true` for `{city:'Cebu City', region:'Central Visayas', country:'PH'}`;
    - `true` for `{city:'Mandaue City', country:'PH'}`;
    - `true` for `{city:'Lapu-Lapu City'}`;
    - `true` for `{address:'IT Park, Lahug'}`;
    - `true` for `{city:'Talisay City', region:'Cebu', country:'PH'}`;
    - `true` for a bare `{city:'Cebu', country:'PH'}`;
    - `false` for `{city:'Kecamatan Ubud', region:'Bali', country:'ID'}`;
    - `false` for `{city:'Cebu City', country:'US'}`;
    - **Review Focus 1:** `false` for `{city:'Naga City', region:'Camarines Sur', country:'PH'}`, `{city:'Talisay City', region:'Negros Occidental', country:'PH'}`, `{city:'Danao', region:'Bohol', country:'PH'}` and `{city:'Compostela', region:'Davao de Oro', country:'PH'}`.
  - `normalizeCity` (imported from `search-doc.ts`) keeps today's answers: `{city:'Mandaue City', location:null, format:'in_person'}` → `'Mandaue'`, and a bare `{city:'Cebu', …}` → `null`.

- [ ] **Step 2: Run them and watch them fail**
  Run: `cd services/core && deno test --no-config --node-modules-dir=none --no-lock tests/cebu_rule_test.ts`
  Expected: FAIL, module `../supabase/shared/cebu-rule.ts` not found.

- [ ] **Step 3: Implement `cebu-rule.ts` and repoint `search-doc.ts`**
  - **`isInCebu`:**
    - When `country` is present, it must be `PH` or `Philippines` (case-insensitive).
    - Then join `city`, `region` and `address` into one text.
    - Mandaue, Lapu-Lapu, Mactan, `cebu city` and the Cebu City areas count on their own.
    - An `OTHER_CITIES` town counts only when the text also contains `cebu` (Review Focus 1).
    - Any other text containing the word `cebu` counts.
  - **`search-doc.ts`:** imports `matchCebuCity` from `./cebu-rule.ts` and calls it where it called `matchCity`.

- [ ] **Step 4: Run the tests and see them pass**
  Run: the command from Step 2.
  Expected: PASS, every case.

- [ ] **Step 5: Commit**
  `git add services/core/supabase/shared/cebu-rule.ts services/core/supabase/shared/search-doc.ts services/core/tests/cebu_rule_test.ts`
  Then `git commit -m "feat(core): add the shared Cebu rule for events"`.

### Task 2: Migration: the column, the finding line, the cron

**Files:**
- Create: `services/core/supabase/migrations/20261105010000_eventbrite_finding.sql`
- Create: `services/core/supabase/tests/eventbrite_finding_test.sql`
- Modify: any existing pgTAP assertion that expects Eventbrite finding to be `not_set_up`. Grep `services/core/supabase/tests/` for `not_set_up` together with `eventbrite`.
- Modify: `services/core/supabase/shared/database.types.ts`. Add `is_cebu_based: boolean` to `accounts.Row`, and `is_cebu_based?: boolean` to `Insert` and `Update`, next to `is_active`.
- Modify: `ARCHITECTURE.md`. In the "Status rules" bullet, `not_set_up (Eventbrite finding)` becomes `not_set_up (no line uses it today)`. Add the Eventbrite cron to the finding-cron list.

**Interfaces:**
- Produces:
  - `public.accounts.is_cebu_based boolean NOT NULL DEFAULT false`.
  - `public.finding_targets()` returns active `eventbrite` accounts as `('eventbrite', 'finding', account_id, name)`.
  - `private.record_finding_runs('eventbrite')`.
  - Cron `sync-eventbrite-accounts`.

- [ ] **Step 1: Write the failing pgTAP file** `eventbrite_finding_test.sql`. Copy the setup and rollback style of `status_diagnostics_test.sql`. Assert:
  - `has_column('public', 'accounts', 'is_cebu_based')`, `col_not_null(…)`, and `col_default_is(…, 'false')`.
  - With an inserted active Eventbrite account `'eb-test-1'` (`type 'eventbrite'`, `kind 'eventbrite_organizer'`) and an inactive `'eb-test-2'`, `finding_targets()` returns `('eventbrite','finding','eb-test-1')` and nothing for `eb-test-2`.
  - `private.record_finding_runs('eventbrite')` inserts one `scheduled-run` row with `bucket 'eventbrite'`, `metadata->>'line' = 'finding'` and `(metadata->>'expected')::int` equal to the number of active Eventbrite targets.
  - `private.scraper_status_at(now())` returns `not_checked` for `(eventbrite, finding)` when there's no Eventbrite finding evidence. It's no longer `not_set_up`.
  - After inserting an `account_processed` row with `metadata {line:'finding', page_read:true}` two hours old, `private.scraper_history_at(now())` has a row for `(eventbrite, finding)` in that window.
  - `cron.job` has `jobname 'sync-eventbrite-accounts'` with schedule `'45 */6 * * *'`, and its command contains `record_finding_runs('eventbrite')` and `retrieve-and-sync-to-db-eventbrite-events`.

- [ ] **Step 2: Run pgTAP and watch it fail**
  Run: `cd services/core && npx -y supabase@3.0.0 test db`
  Expected: `eventbrite_finding_test.sql` fails, on the missing column first.

- [ ] **Step 3: Write the migration**
  - `ALTER TABLE public.accounts ADD COLUMN is_cebu_based boolean NOT NULL DEFAULT false;`, plus a `COMMENT` that says what it means (decision table, spec §Decisions 2).
  - `CREATE OR REPLACE` the following, each copied from `20261104020000_status_diagnostics.sql` and changed only as stated:
    - **`public.finding_targets()`:** add `'eventbrite'` to the type list, and add `OR a.type = 'eventbrite'` to the routing. Eventbrite has no `discovery_path` requirement. The header comment names `retrieve-and-sync-to-db-eventbrite-events` as a mirror.
    - **`private.record_finding_runs(text)`:** add `('eventbrite', 'finding')` to the `VALUES`.
    - **`private.scraper_status_at(timestamptz)`:** catalogue row 9's kind changes to `'finding'`. Same signature and return table, so `CREATE OR REPLACE` keeps the `public` wrapper.
  - `SELECT cron.schedule('sync-eventbrite-accounts', '45 */6 * * *', $cron$ … $cron$)`, shaped like `sync-meetup-accounts`. The function URL is `https://enwcrupzidbcwimyttla.supabase.co/functions/v1/retrieve-and-sync-to-db-eventbrite-events`.

- [ ] **Step 4: Apply and run pgTAP**
  Run: `docker exec -i supabase_db_service psql -v ON_ERROR_STOP=1 -U postgres -d postgres -q < supabase/migrations/20261105010000_eventbrite_finding.sql && npx -y supabase@3.0.0 test db`. Or reset the local DB if the stack is fresh.
  Expected: all pgTAP files pass, including the updated `not_set_up` assertions and the column pins on the public wrappers.

- [ ] **Step 5: Commit**
  Commit the migration, the new and updated tests, `database.types.ts` and `ARCHITECTURE.md` with `git commit -m "feat(health): make the Eventbrite finding line real"`.

### Task 3: Eventbrite organizer endpoints

**Files:**
- Create: `services/eventbrite/supabase/functions/_shared/organizer-api.ts`
- Create fixtures in `services/eventbrite/tests/fixtures/organizer/`. Capture them with `curl -s -A "<HTML_HEADERS UA>" -H "Accept: application/json"`:
  - `code-orange-events.json`: E1 for `110850996031`, page 1.
  - `wtm-cebu-events.json`: E1 for `109571894561`.
  - `organizer-404.json`: E2 for `99999999999`.
  - `code-orange-organizer.json`: E2 for `110850996031`.
  - `bitcoin-meetup-series-dates.json`: E4 for `2002279245122`.
  - `series-parent-event.json`: E3 for `2002279245122`.
  - `one-off-event.json`: a copy of `series-parent-event.json` with `is_series` and `is_series_parent` set to `false`. Every Code Orange event tested on 2026-11-05 was a series.
  - `CAPTURED_AT.txt`: the UTC time of capture. Tests use it as `now`, so the fixtures never go stale.
- Test: `services/eventbrite/tests/organizer_api_test.ts`

**Interfaces:**
- Consumes: `ReadFailure`, `httpFailure` from `@service/core/supabase/shared/health-checks.ts`; `PhysicalPlace` from Task 1.
- Produces:
  - `export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>`
  - `export interface ListedEvent { id: string; name: string; url: string; isOnline: boolean; isCancelled: boolean; venue: PhysicalPlace | null }`. Here `venue.address` is `localized_address_display`.
  - `export interface SeriesDate { id: string; startUtc: string }`
  - `export const E1_PAGE_CAP = 5`
  - `export async function fetchOrganizer(id: string, fetchFn?: FetchFn): Promise<{ ok: true; name: string } | { ok: false; failure: ReadFailure }>`
  - `export async function listOrganizerEvents(id: string, fetchFn?: FetchFn): Promise<{ ok: true; events: ListedEvent[] } | { ok: false; failure: ReadFailure }>`
  - `export async function isSeriesParent(eventId: string, fetchFn?: FetchFn): Promise<boolean>`
  - `export async function fetchSeriesDates(parentId: string, fetchFn?: FetchFn): Promise<SeriesDate[]>`

- [ ] **Step 1: Write the failing tests.** Each uses a fake `FetchFn` that serves the fixtures by URL and records the calls.
  - `listOrganizerEvents('110850996031')` → `ok`, 17 events. The one with `id '2002279245122'` has `isOnline false` and `venue.city 'Cebu City'`, `venue.country 'PH'`.
  - `wtm-cebu-events.json` → `ok`, `events: []`. A quiet organizer is read.
  - `fetchOrganizer('99999999999')` with a `404` → `{ok:false, failure.code 'not_found'}`. With `200` → `{ok:true, name 'Code Orange Dev School'}`.
  - A `500` → `fetch_failed`, and a `429` → `rate_limited`, for both calls.
  - **Review Focus 3:** `200` with `Content-Type: text/html` and an HTML body → `{ok:false, failure.code 'unexpected_page'}`. Same for JSON without an `events` array.
  - Pagination: page 1 `hasMore:true`, page 2 `hasMore:false` → events from both pages, and calls show `page=1` then `page=2`.
  - **Review Focus 4:** every page `hasMore:true` → stops after `E1_PAGE_CAP` calls and still returns `ok:true`.
  - `isSeriesParent` → `true` for `series-parent-event.json`, `false` for `one-off-event.json`.
  - `fetchSeriesDates('2002279245122')` → the first date is `{id:'2004210346097'}` with a `startUtc` parsed from `start.utc`.

- [ ] **Step 2: Run them and watch them fail**
  Run: the Eventbrite test command.
  Expected: FAIL, `organizer-api.ts` not found.

- [ ] **Step 3: Implement `organizer-api.ts`.** Each call checks the status first (`httpFailure`), then the `Content-Type` and JSON shape (`unexpected_page`). `fetchFn` defaults to `fetch`. Map E1's `primary_venue.address` to `PhysicalPlace`; a missing `primary_venue` is `venue: null`.

- [ ] **Step 4: Run the tests and see them pass**
  Run: the Eventbrite test command.
  Expected: PASS, and the existing Eventbrite tests are still green.

- [ ] **Step 5: Commit** with `git commit -m "feat(eventbrite): read an organizer's upcoming events"`.

### Task 4: Choose what to import for one organizer

**Files:**
- Create: `services/eventbrite/supabase/functions/_shared/discovery.ts`
- Test: `services/eventbrite/tests/discovery_test.ts`

**Interfaces:**
- Consumes: Task 3's functions and types; `countsForCebby` from Task 1.
- Produces:
  - `export const SERIES_MAX_DATES = 2`; `export const SERIES_HORIZON_DAYS = 60`
  - `export function pickSeriesDates(dates: SeriesDate[], now: Date): SeriesDate[]`
  - `export type Skip = { id: string; reason: 'cancelled' | 'no_venue' | 'outside_cebu' | 'online_not_cebu_based' }`
  - `export type ImportPlan = { pageRead: true; urls: string[]; skipped: Skip[] } | { pageRead: false; readError: ReadFailure }`
  - `export async function planOrganizerImports(account: { account_id: string; is_cebu_based: boolean }, deps: { fetchFn?: FetchFn; now: Date }): Promise<ImportPlan>`. Each URL is `https://www.eventbrite.com/e/{id}`.

- [ ] **Step 1: Write the failing tests.** Use Task 3's fixtures through a fake `FetchFn`, with `now` read from `CAPTURED_AT.txt`.
  - `pickSeriesDates`, on hand-built date lists so the values are exact:
    - Monthly dates Nov 6, Dec 4 and Dec 30 2026, with `now` = 2026-11-05T00:00Z → the Nov 6 and Dec 4 dates only. Dec 30 is the third, inside 60 days.
    - Dates only beyond 60 days → `[]`.
    - Dates already past → excluded.
  - Code Orange with `is_cebu_based false`:
    - `pageRead true`.
    - The URLs are exactly the first 2 dates of `bitcoin-meetup-series-dates.json` that are after `now` and within 60 days.
    - Every fixture event with `is_online_event true` is in `skipped` as `online_not_cebu_based`.
    - Every one with an `ID` venue is in `skipped` as `outside_cebu`.
  - The same organizer with `is_cebu_based true` → the online events are kept, and their series are expanded the same way.
  - A cancelled listed event → `skipped` with `cancelled`.
  - A non-online event with no venue → `no_venue`.
  - A one-off Cebu event dated 5 months after `now` → its URL is kept.
  - Women Techmakers Cebu (empty list) → `{pageRead:true, urls:[], skipped:[]}`.
  - E2 `404` → `{pageRead:false, readError.code 'not_found'}`, and no E1 call is made.
  - E3/E4 calls only happen for events that passed the filter. Assert the call log: no E3 for any Bali or online Code Orange event when not Cebu-based.

- [ ] **Step 2: Run them and watch them fail**
  Run: the Eventbrite test command. Expected: FAIL, `discovery.ts` not found.

- [ ] **Step 3: Implement `discovery.ts`.**
  1. `fetchOrganizer`, then `listOrganizerEvents`.
  2. Filter each event: cancelled, then online (`countsForCebby({online:true}, …)`), then venue (`null` → `no_venue`; otherwise `countsForCebby({online:false, ...venue}, …)`).
  3. Each kept event is either a series parent (`fetchSeriesDates` → `pickSeriesDates`) or a one-off. De-duplicate the URLs.

- [ ] **Step 4: Run the tests and see them pass.** Expected: PASS.

- [ ] **Step 5: Commit** with `git commit -m "feat(eventbrite): choose which organizer events to import"`.

### Task 5: One import path, the organizer sync, and the cron handler

**Files:**
- Create: `services/eventbrite/supabase/functions/_shared/import-event.ts`. It moves `resolveOrganizer` and the scrape → ingest → covers → geocode steps out of `eventbrite-scraper/index.ts`.
- Create: `services/eventbrite/supabase/functions/_shared/sync-organizer.ts`
- Modify: `services/eventbrite/supabase/functions/eventbrite-scraper/index.ts`. It calls `importEventbriteEvent`, keeping every response it has today: 400, 404, 422 for a series page, 500.
- Replace: `services/eventbrite/supabase/functions/retrieve-and-sync-to-db-eventbrite-events/index.ts`. The stub becomes the handler.
- Modify: `services/eventbrite/README.md` (the TODOs become the real pipeline) and the Eventbrite parts of `ARCHITECTURE.md`.
- Test: `services/eventbrite/tests/import_event_test.ts`, `services/eventbrite/tests/sync_organizer_test.ts`

**Interfaces:**
- Consumes: Task 4's `planOrganizerImports` and `ImportPlan`; Task 1's `countsForCebby` and `EventPlace`; `FindingRun`, `findingMetadata` and `ReadFailure` from core `health-checks.ts`; `recordServiceHealthEvent`.
- Produces:
  - `export function placeOfEventbriteEvent(event: EventbriteEvent): EventPlace`. `location === 'Online'` → `{online:true}`; otherwise the `venue` fields, with `address` from `venue.address`.
  - `export function withCebuAnchor(ingest: IngestEvent, accountIsCebuBased: boolean): IngestEvent`. An online ingest from a Cebu-based account gets `city 'Cebu City'`, `region 'Central Visayas'`, `country 'Philippines'`. Anything else is returned unchanged.
  - `export type ImportOutcome = { kind: 'imported'; result: IngestResult } | { kind: 'not_found' } | { kind: 'series_parent'; seriesId: string; name: string } | { kind: 'skipped'; reason: string } | { kind: 'organizer_failed'; organizer: string }`
  - `export async function importEventbriteEvent(canonicalUrl: string, opts?: { accountIsCebuBased?: boolean; check?: (event: EventbriteEvent) => boolean }): Promise<ImportOutcome>`
  - `export interface OrganizerSyncResult { run: FindingRun; ingested: number; failures: { url: string; message: string }[] }`
  - `export async function syncOrganizer(account: { account_id: string; is_cebu_based: boolean }, deps: { plan: typeof planOrganizerImports; importOne: typeof importEventbriteEvent; now: Date }): Promise<OrganizerSyncResult>`

- [ ] **Step 1: Write the failing tests**
  - **`import_event_test.ts`:**
    - `placeOfEventbriteEvent` on the parsed `bitcoin-meetup-occurrence.html` fixture (via `parseEventbriteEventPage`) → physical, with the city containing Cebu.
    - An event with `location 'Online'` → `{online:true}`.
    - `withCebuAnchor`: online with a Cebu-based account → the three anchor values; online with another account → unchanged; in person with a Cebu-based account → unchanged.
  - **`sync_organizer_test.ts`,** with a fake `plan` and `importOne`:
    - A plan with `pageRead:false` → `run {line:'finding', pageRead:false, readError}`, and `importOne` is never called.
    - Two URLs, both imported → `ingested 2`, `run.pageRead true`.
    - **Review Focus 5:** two URLs where the second `importOne` throws → `run.pageRead true`, `ingested 1`, and `failures` holds that URL and the message.
    - **Review Focus 2:** `syncOrganizer` passes `importOne` a `check` that rejects an event placed outside Cebu. Call the captured `check` with a parsed event whose venue is Makati → `false`; with the Cebu occurrence fixture → `true`.

- [ ] **Step 2: Run them and watch them fail**
  Run: the Eventbrite test command. Expected: FAIL, the modules are not found.

- [ ] **Step 3: Implement**
  - **`import-event.ts`:**
    - It holds what the scraper does today: fetch, then `series_parent` and `not_found` outcomes, `resolveOrganizer` (keep the refusal when the organizer id belongs to another platform), `ingestEvents([withCebuAnchor(toIngestEvent(…), …)])`, `getEventsByIds`, `storeCoverImages`, `geocodeEventLocations`.
    - A `check` that returns `false` → `{kind:'skipped', reason:'outside_rule'}` before ingest.
  - **`sync-organizer.ts`:**
    - It sets `run.line = 'finding'` and calls `plan`.
    - For each URL it calls `importOne(url, { accountIsCebuBased, check: (e) => countsForCebby(placeOfEventbriteEvent(e), account.is_cebu_based) })` inside try/catch, and counts `imported`.
  - **The handler:**
    - It reads the account from the POST body, which is the `accounts` row from `fan_out_account_syncs` and includes `is_cebu_based`.
    - It calls `syncOrganizer` with the real deps and `now: new Date()`.
    - It records one row per organizer, like Meetup's handler: `bucket 'eventbrite'`, `source 'retrieve-and-sync-to-db-eventbrite-events'`, `fingerprint 'account_processed'`, `metadata {ingested, ...findingMetadata(run)}`. On a crash: `cron_account_failed` with `findingMetadata(run, {crashed:true, error})`.
    - It also records one `warning` row per failure: `fingerprint 'event_import_failed'`, `metadata {event_url}`, and **no `line` key**, so the row doesn't count toward the status line.
    - It returns `200` with `{account_id, ingested, failures: n}`.
  - **`cron-sync-eventbrite-organizers`:** leave it. The spec leaves its removal to the builder, and nothing schedules it.

- [ ] **Step 4: Run the tests and typecheck**
  Run: the Eventbrite test command, then `cd services/eventbrite && deno check --import-map=supabase/functions/import_map.json supabase/functions/eventbrite-scraper/index.ts supabase/functions/retrieve-and-sync-to-db-eventbrite-events/index.ts`.
  Expected: tests PASS. `deno check` shows no new errors; compare against `main` if it reports existing ones.

- [ ] **Step 5: Commit** with `git commit -m "feat(eventbrite): sync watched organizers every 6 hours"`.

### Task 6: Admin: watch an organizer, set Cebu-based, see unread organizers

**Files:**
- Create: `apps/admin/src/lib/eventbrite-organizer.ts`
- Create: `apps/admin/src/pages/api/accounts/add-eventbrite-watch.ts`
- Create: `apps/admin/src/pages/api/accounts/eventbrite-settings.ts`
- Modify: `apps/admin/src/pages/orgs.astro`. Add a "Watch an Eventbrite organizer" section after the Facebook one (lines 267–293), with the same markup and a `HelpPopover`. Add an "Eventbrite organizers" list with a Cebu-based toggle and an active toggle per row, each a small POST form.
- Modify: `apps/admin/src/lib/health-report.ts`. Add `{ source: 'eventbrite', line: 'finding', sourceLabel: 'Eventbrite', lineLabel: 'Finding new events' }` to `LINES` (line 83).
- Test: `apps/admin/tests/eventbrite-organizer.test.ts`; extend `apps/admin/tests/health-report.test.ts`.

**Interfaces:**
- Produces:
  - `export type OrganizerInput = { kind: 'organizer'; organizerId: string; path: string | null } | { kind: 'event'; eventId: string } | { error: string }`
  - `export function parseEventbriteOrganizerInput(raw: string): OrganizerInput`. It accepts `https://www.eventbrite.com/o/<slug>-<id>`, a bare numeric id, and an event URL `…/e/<slug>-<id>`, on any Eventbrite host that `isEventbriteHost` accepts. Anything else is `{error}`.
  - `export async function resolveEventbriteOrganizer(input: OrganizerInput, fetchFn?: typeof fetch): Promise<{ organizerId: string; name: string } | { error: string }>`. An event input goes through E3 (`organizer_id`). Every input ends with E2 for the name; E2 `404` → `{error: 'No Eventbrite organizer with id …'}`.

- [ ] **Step 1: Write the failing tests**
  - `parseEventbriteOrganizerInput`:
    - `'https://www.eventbrite.com/o/code-orange-dev-school-110850996031'` → organizer `110850996031`, path `code-orange-dev-school-110850996031`.
    - `'110850996031'` → organizer.
    - `'https://www.eventbrite.com/e/bitcoin-meetup-cebu-tickets-2004210346097'` → `{kind:'event', eventId:'2004210346097'}`.
    - `'https://www.facebook.com/x'` and `''` → `{error}`.
  - `resolveEventbriteOrganizer` with a fake fetch: an organizer input resolves the name from E2; an event input calls E3, then E2; E2 `404` → `{error}`.
  - In `health-report.test.ts`: the report includes an Eventbrite "Finding new events" line, and an unread Eventbrite organizer row is listed under it.

- [ ] **Step 2: Run them and watch them fail**
  Run: the admin test command. Expected: FAIL.

- [ ] **Step 3: Implement**
  - The lib functions.
  - **The add route,** modelled on `add-watch.ts`:
    - It parses, then resolves.
    - If an account with that id exists and isn't Eventbrite → error flash.
    - If an Eventbrite account exists → update `is_cebu_based` from the checkbox and show an info flash.
    - Otherwise insert `{account_id, name, type 'eventbrite', kind 'eventbrite_organizer', is_active true, is_cebu_based, account_details {path, organizer_id}}`.
    - It redirects to `/orgs` with a flash.
  - **The settings route:** it updates `is_cebu_based` and/or `is_active` for `type = 'eventbrite'` rows only.
  - The `/orgs` markup and the health-report line.

- [ ] **Step 4: Run the tests and build**
  Run: the admin test command, then `PATH="$HOME/Library/pnpm:$PATH" pnpm --filter @cebby/admin build`.
  Expected: PASS, and the build succeeds.

- [ ] **Step 5: Commit** with `git commit -m "feat(admin): watch Eventbrite organizers"`.

### Task 7: PWA: publish what Cebby lists

**Files:**
- Modify: `apps/pwa/src/pages/how-cebby-verifies-events.astro`. Add a section after the intro section (which ends at about line 104), in the page's existing styles.

- [ ] **Step 1: Add the "What Cebby lists" section** with the spec's copy (§PWA, "What counts, published"): the heading, the one-line lead, and the four bullets. Keep the meaning; light polish is fine.

- [ ] **Step 2: Build and look at it**
  Run: `PATH="$HOME/Library/pnpm:$PATH" pnpm --filter pwa build`. Then screenshot `/how-cebby-verifies-events` from `cd apps/pwa && pnpm exec astro dev --port 4410`, using headless Chrome with a fresh `--user-data-dir`, at desktop width and at 390 px inside an iframe.
  Expected: the build succeeds, and the section reads cleanly at both widths.
  Ruling: this step is copy only, so the build and screenshots are its test.

- [ ] **Step 3: Commit** with `git commit -m "feat(pwa): say which events Cebby lists"`.

### Task 8: Whole-branch check and PR

- [ ] **Step 1: Run every suite**
  - Core: `cebu_rule_test.ts` and `health_checks_test.ts`.
  - The Deno suites of `facebook`, `luma`, `meetup` and `eventbrite` (the loop from the status-diagnostics `svc-tests.sh`).
  - `npx -y supabase@3.0.0 test db`.
  - Admin tests and build.
  - PWA tests (`pnpm --filter pwa test`) and build.

  Expected: all green.
- [ ] **Step 2: Re-check the migration order.** Run `git fetch origin && git ls-tree --name-only origin/main services/core/supabase/migrations/ | tail -3`. Expected: nothing newer than `20261104020000`; if there is, rename this migration to sort after it.
- [ ] **Step 3: Push and open the PR** against `main`. Put the PR description in the outbox (`outbox add … --to pr:getcebby/cebby:feat/eventbrite-finding --subject …`). Run `codex-review-wait <pr-url>` in the background and fix Codex's findings.
- [ ] **Step 4: Stop at a ready PR.** Merging deploys the functions and the migration to production. Only Dorell merges.
- [ ] **After merge (production, read-only):** follow the spec's §Verification after the next `:45` run.
