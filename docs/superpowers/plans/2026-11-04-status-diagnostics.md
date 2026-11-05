# /status diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Back every `/status` state with recorded evidence (run-started rows, expected accounts, partial results), rename the states, explain problems in plain words, make the bars inspectable without a script, and show the causes on an admin page.

**Architecture:**
- Scheduled runs write a `scheduled-run` row to `service_health_events`. The cron handlers record a failure cause next to `page_read: false`.
- One migration replaces the status and history functions. They add expected/missed counts, a `degraded` state and a counts-only `latest` field.
- The PWA maps the SQL states to five words and renders native popovers.
- The admin app reads the raw rows with its service-role client.

**Tech Stack:**
- Postgres 17 (Supabase), pgTAP, pg_cron and pg_net
- Deno edge functions, tested with `jsr:@std/testing`
- Astro 5: the PWA on Cloudflare, the admin app on the Node adapter
- vitest

**Spec:** `docs/superpowers/specs/2026-11-04-status-diagnostics-design.md`

## Global Constraints

**Database and production**
- Migration file: `services/core/supabase/migrations/20261104020000_status_diagnostics.sql`. Before merge, re-check that it still sorts after `main`'s latest, since PR C adds `20261104010000`.
- Never `REVOKE EXECUTE` on a public function from an API role. Internal functions go in `private`; public wrappers are `SECURITY DEFINER` and granted to `anon, authenticated, service_role`.
- Never call `private.run_link_checks()` and never invoke scrapers against production. Production access is read-only only (`npx -y supabase@3.0.0 db query --remote=enwcrupzidbcwimyttla --read-only -f <file>`).
- Supabase CLI is pinned to 3.0.0. Local tests: `cd services/core && SUPABASE_DB_SEED_ENABLED=false npx -y supabase@3.0.0 db start`, then `npx -y supabase@3.0.0 test db`. The Docker stack is shared with another session. To reload SQL by hand: `docker exec -i supabase_db_service psql -v ON_ERROR_STOP=1 -U postgres -d postgres -q < file`.

**Public data**
- The public RPCs return counts and times only. No cause codes, messages, account ids or URLs. `anon` still gets 42501 on `service_health_events`.

**Page words and contract**
- `/status` has no client script. "Updated:" and "Noticed:" keep their exact words.
- Line words: Healthy, Degraded, Broken, Unknown, Not configured. Headline: "All healthy" / "1 problem" / "N problems". Missing time: "not in the last 7 days".
- Popover text never contains a line word, "Noticed" or "Updated".

**Process and design**
- TDD: each test is seen failing before the code exists.
- Commits: short imperative subject, conventional prefix. Body: one line per paragraph. No AI attribution.
- Design: `.impeccable.md` pill palette (emerald / amber / rose / stone), still dots, purple only for active or primary.

## Review Focus

1. **The old and new RPC shapes during deploy.** Cloudflare may serve the new PWA before `db push`, or the reverse. Neither page may crash; `mixed` must render like `partial`, and missing `latest` must render without a sentence count. Pinned in Task 6.
2. **A finding window that is still landing** (within an hour of its start) must not judge as partial against `expected`. Pinned in Task 4: a window 30 minutes old is ignored.
3. **An account that reports twice in one window** (a manual rerun) must count once, by its latest row. Pinned in Task 4.
4. **A cron that fires twice in a window** must not double `expected`, which is the max, not the sum. Pinned in Task 4.
5. **A raw message containing a line word or a URL** must never reach `/status`. The public functions don't select `message` or `metadata`, which the Task 4 safety test pins by comparing the returned column list to an allowlist.

---

### Task 1: Shared failure causes and link failure codes

**Files:**
- Modify: `services/core/supabase/shared/health-checks.ts`
- Test: `services/core/tests/health_checks_test.ts` (run `cd services/core && deno test tests/health_checks_test.ts`)

**Interfaces:**
- Produces:
  - `type ReadErrorCode = 'token_rejected' | 'permission_denied' | 'rate_limited' | 'not_found' | 'no_event_list' | 'unexpected_page' | 'fetch_failed' | 'crashed' | 'other'`
  - `interface ReadFailure { code: ReadErrorCode; detail: string }`
  - `FindingRun` gains `readError?: ReadFailure | null`
  - `httpFailure(status: number, what: string): ReadFailure`: 404 and 410 → `not_found`; 429 → `rate_limited`; anything else → `fetch_failed`. The detail is `` `${what}: HTTP ${status}` ``.
  - `findingMetadata(run, opts?: { crashed?: boolean; error?: unknown })`. When the page wasn't read it adds `read_error` and `read_error_detail` (cut to 300 characters).
    - A crash without `readError` records `read_error: 'crashed'`, with the detail taken from `opts.error`.
    - A read page adds neither key.
  - `type LinkFailureCode = 'missing_title' | 'missing_start_time' | 'missing_location' | 'read_error'`; `linkFailureCode(reason: string): LinkFailureCode`
  - `linkCheckHealthEvent` adds `metadata.failure` on `failed` only.

- [ ] **Step 1: Write the failing tests**
  - `findingMetadata` with `{line:'finding', pageRead:false, readError:{code:'not_found', detail:'x'.repeat(400)}}` gives `read_error: 'not_found'`, and `read_error_detail` of length 300.
  - With `pageRead: true` the result is exactly `{ line, page_read: true }`.
  - A crash with `pageRead: null` and `error: new Error('boom')` gives `{ line, page_read: false, read_error: 'crashed', read_error_detail: 'boom' }`.
  - `httpFailure(404,'group page').code === 'not_found'`, 429 gives `rate_limited`, 503 gives `fetch_failed`.
  - `linkFailureCode`:
    - `'missing title'` → `missing_title`
    - `'missing start time'` → `missing_start_time`
    - `'missing location'` → `missing_location`
    - `'HTTP 500'` → `read_error`
  - `linkCheckHealthEvent('meetup', {status:'failed', attempts:[{url:'u', outcome:'broken', reason:'missing start time'}]}).metadata.failure === 'missing_start_time'`. The `passed` and `no_sample` events have no `failure` key.
- [ ] **Step 2: Run them and see them fail**, because the exports don't exist yet.
- [ ] **Step 3: Implement** in `health-checks.ts`.
- [ ] **Step 4: Run them and see them pass.** Run the whole file.
- [ ] **Step 5: Commit** `feat(health): record why a page wasn't read`

### Task 2: Each source records its cause

**Files:**
- Modify:
  - `services/meetup/supabase/functions/_shared/meetuputils.ts` and `services/meetup/supabase/functions/retrieve-and-sync-to-db-meetup-events/index.ts`
  - `services/luma/supabase/functions/_shared/lumautils.ts` and `services/luma/supabase/functions/retrieve-and-sync-to-db-luma-events/index.ts`
  - `services/facebook/supabase/functions/_shared/graph-events.ts` and `services/facebook/supabase/functions/retrieve-and-sync-to-db-events/index.ts`
- Test:
  - `services/meetup/tests/listing_test.ts`
  - `services/luma/tests/listing_test.ts`
  - `services/facebook/tests/graph_events_test.ts`
  - `services/facebook/tests/watch_list_test.ts`, or a new `watch_failure_test.ts`
  - Run with `pnpm --filter <svc> test`; check the package names first.

**Interfaces:**
- Consumes: `ReadFailure` and `httpFailure` from Task 1, via `import type` or import from `@service/core/supabase/shared/health-checks.ts`.
- Produces:
  - `listEventsForMeetupGroup` and `listEventsForLumaPath` return `{ pageRead: boolean; events; readError?: ReadFailure }`. `readError` is present only when `pageRead` is false.
  - `class GraphApiError extends Error { code: number | null; status: number }`, thrown by `fetchGraphEvents`. Its message never contains the URL.
  - `classifyGraphError(err: unknown): ReadFailure`:
    - 190, 102, 463, 467 → `token_rejected`
    - 10 or 200–299 → `permission_denied`
    - 4, 17, 32, 613 or HTTP 429 → `rate_limited`
    - other HTTP errors and a non-Graph throw → `fetch_failed`
    - anything else → `other`
  - `classifyWatchListError(message: string): ReadFailure`:
    - `/no event data found/i` → `no_event_list`
    - `/invalid facebook page event url/i` → `not_found`
    - anything else → `fetch_failed`

- [ ] **Step 1: Write the failing tests**
  - **Meetup:**
    - HTTP 404 gives `readError.code === 'not_found'`.
    - A network throw gives `fetch_failed`.
    - A page whose Apollo `ROOT_QUERY` has a `groupByUrlname(...)` key set to null gives `not_found`.
    - A page with no Apollo state gives `unexpected_page`.
    - Existing read cases have no `readError`.
  - **Luma:**
    - Calendar HTTP 500 gives `fetch_failed`.
    - A calendar page without `initialData.data` gives `unexpected_page`.
    - A user page with `pageProps.status 404` gives `not_found`.
    - An api2 429 gives `rate_limited`.
  - **Graph:**
    - A body of `{error:{code:190,message:'Session has expired'}}` makes `fetchGraphEvents` throw a `GraphApiError` with `code 190`, and `classifyGraphError` of it gives `token_rejected`.
    - `{error:{code:10}}` gives `permission_denied`.
    - HTTP 500 with no body gives `fetch_failed`.
    - `new TypeError('network')` gives `fetch_failed`.
  - **Watched pages:** `classifyWatchListError('No event data found, please verify…').code === 'no_event_list'`.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.**
  - **Meetup and Luma:** add a private `fetchPage(url, label): Promise<{ html: string } | { failure: ReadFailure }>` that uses `httpFailure`. Keep `fetchHtml` as a wrapper for the other callers.
  - **Handlers** set `run.readError` from the listing, the Graph catch and the watch-list catch. Each crash `catch` passes `{ crashed: true, error }` to `findingMetadata`.
  - **Each handler's routing branch** gets one comment line: "Routing is mirrored by public.finding_targets() (migration 20261104020000); change both."
- [ ] **Step 4: Run each service's tests and see them pass,** including the existing ones.
- [ ] **Step 5: Commit** `feat(cron): record the cause when a listing isn't read`

### Task 3: Run-started rows and expected accounts

**Files:**
- Create: `services/core/supabase/migrations/20261104020000_status_diagnostics.sql` (section 1 of 3)
- Test: `services/core/supabase/tests/scheduled_runs_test.sql`

**Interfaces:**
- Produces (SQL):
  - `public.finding_targets() RETURNS TABLE (source text, line text, account_id text, name text)`. It is `SECURITY INVOKER`, `STABLE`, and follows the spec §2 rules.
  - `private.record_finding_runs(p_type text) RETURNS void`. It writes one row per line of that type: `bucket = p_type`, `source = 'scheduled-run'`, `status = 'success'`, `fingerprint = 'run_started'`, `metadata = {"line": …, "expected": n}`. A line with no targets still gets `expected: 0`.
  - `private.run_link_checks()`: unchanged except that it inserts four rows with `{"line":"link"}` (facebook, luma, meetup, eventbrite), same `source`/`fingerprint`, before the posts.
  - The `sync-luma-accounts`, `sync-meetup-accounts` and `sync-fb-accounts` jobs are re-scheduled under the same names. Each command becomes `SELECT private.record_finding_runs('<type>'); SELECT public.fan_out_account_syncs('<type>', '<same url as today>');`.

- [ ] **Step 1: Write the failing pgTAP test**
  - Seed `accounts` and `account_secrets`:
    - a Facebook account with a page token (partner);
    - a Facebook `public_scrape` account with `discovery_path` (watched);
    - a Facebook `public_scrape` account without `discovery_path` (not targeted);
    - an inactive Meetup account;
    - Meetup and Luma accounts with and without `discovery_path`.
  - Assert the `finding_targets()` rows per (source, line).
  - `record_finding_runs('facebook')` inserts exactly 2 rows, with expected counts 1 and 1.
  - `cron.job` commands for the three jobs contain `record_finding_runs`.
  - `SET ROLE anon; SELECT throws_ok('SELECT * FROM public.finding_targets()', '42501')`.
- [ ] **Step 2: Run `npx -y supabase@3.0.0 test db` and see it fail.**
- [ ] **Step 3: Write section 1 of the migration.** Reset the local database (`npx -y supabase@3.0.0 db reset --local` with `SUPABASE_DB_SEED_ENABLED=false`), or reload the file by hand.
- [ ] **Step 4: Run pgTAP and see it pass.**
- [ ] **Step 5: Commit** `feat(health): record when scheduled checks start`

### Task 4: Status rules: partial, degraded, missed

**Files:**
- Modify: migration section 2, which drops and recreates `public.get_scraper_status()` and `private.scraper_status_at(timestamptz)`.
- Test: `services/core/supabase/tests/scraper_status_test.sql`. Update cases whose meaning changed, where read < reported used to pass, and add the new cases.

**Interfaces:**
- Produces: `private.scraper_status_at(p_now)` and `public.get_scraper_status()` return the existing 10 columns plus:
  - `last_run_at timestamptz`
  - `missed_runs int`
  - `latest jsonb`, which is `{result, at}` for link lines and `{result, at, window_start, expected, reported, read}` for finding lines, or null.
- `state` adds `degraded`. Spec §3–§4 define the rules. One detail they leave open: run rows match a link result by bucket within `[run, run + 10 min]`.

- [ ] **Step 1: Write the failing tests.** Each test uses fresh rows at a fixed `p_now`, with helpers `pg_temp.run(bucket, line, expected, at)` and `pg_temp.finding(bucket, line, read, at, account_id)`.
  - **Transitions:** the spec §9 sequence, asserting `state`, `since` and `noticed_at` at each step.
  - **Partial:**
    - E = 22 and 16 rows, all unread: `latest.result = 'fail'`, `latest.reported = 16`, `latest.expected = 22`.
    - E = 22 and 16 rows, all read: `latest.result = 'partial'`.
    - Two such windows give `degraded`.
    - No run row, 15 rows, 12 read: `partial`.
  - **Landing:** a window 30 minutes old is ignored.
  - **Dedupe:** the same account twice in a window counts once (its latest row).
  - **Double fire:** two run rows with expected 22 in one window give `latest.expected = 22`.
  - **Missed:**
    - A link run 5 minutes old with no result gives `missed_runs = 0`.
    - 15 minutes old gives `missed_runs = 1` and the state stays `working`.
    - Runs every hour for 4 hours with the last result 3 h 10 m old give `not_checked`, `last_run_at > last_checked_at` and `missed_runs = 3`.
    - A finding run with no rows, after a pass, gives `missed_runs = 1`, state `working`, and doesn't count as a fail.
  - **Recovery:** degraded → pass gives `working` with null since and noticed; broken → pass gives `working`.
  - **Lone first partial:** `unconfirmed`, with since at its time.
  - **Safety:** the column list of `public.get_scraper_status()` (from `pg_get_function_result`) equals the 13 expected names. `anon` can execute it and still gets 42501 on `service_health_events`.
  - Keep every existing link-line assertion.
- [ ] **Step 2: Run pgTAP and see the new cases fail.**
- [ ] **Step 3: Write section 2.**
  - Start from `20261103040000`'s body.
  - Dedupe finding rows per (line, window, account), then step through them.
  - Classify with the spec §3 order: missed, fail, partial, pass.
  - Compute three trailing runs (non-pass, fail, no_sample) to get `since` and `noticed_at`.
  - Widen the set-aside rule to `('fail','partial')`.
  - `DROP FUNCTION public.get_scraper_status(); DROP FUNCTION private.scraper_status_at(timestamptz);` before the creates. Then `GRANT EXECUTE … TO anon, authenticated, service_role`.
- [ ] **Step 4: Run pgTAP and see it pass.**
- [ ] **Step 5: Commit** `feat(health): judge finding runs against expected accounts`

### Task 5: History windows: expected and missed

**Files:**
- Modify: migration section 3, which drops and recreates `public.get_scraper_history()` and `private.scraper_history_at(timestamptz)`.
- Test: `services/core/supabase/tests/scraper_history_test.sql`

**Interfaces:**
- Produces: history rows gain `expected int` and `missed int`, and `result` takes `pass | partial | fail | no_sample | missed`.
  - Link `mixed` becomes `partial`.
  - For link windows, `expected` = run rows in the window (null when none) and `missed` = runs without a result after 10 minutes.
  - For finding windows, `checks` = distinct accounts reported, `passed` = read, `failed` = reported − read, `expected` = max run expected, and `missed` = max(expected − reported, 0) (null when expected is null).
  - A window holding only run rows (and old enough) is returned with `result = 'missed'` and `checks = 0`.

- [ ] **Step 1: Write the failing tests:**
  - A link window with 6 runs and 5 results gives `expected 6`, `missed 1`, `result 'pass'`.
  - A link window with both passes and fails gives `partial`.
  - A finding window with expected 22 and 16 unread rows gives `checks 16`, `failed 16`, `missed 6`, `result 'fail'`.
  - A finding window with run rows only, an hour old, gives `missed`.
  - Update the existing `mixed` expectation to `partial`.
- [ ] **Step 2: See them fail.**
- [ ] **Step 3: Write section 3.**
- [ ] **Step 4: Run all pgTAP and see it pass.**
- [ ] **Step 5: Commit** `feat(health): show expected and missed checks per window`

### Task 6: PWA view model: words, sentences, popovers

**Files:**
- Modify: `apps/pwa/src/lib/scraper-status.ts`
- Test: `apps/pwa/tests/scraper-status.test.ts` (`pnpm --filter pwa test`)

**Interfaces:**
- Consumes: the Task 4 and Task 5 columns. All new fields are optional on the TS side.
- Produces:
  - `LineState` adds `'degraded'`.
  - `StatusRow` adds `last_run_at?`, `missed_runs?` and `latest?: LatestResult | null`.
  - `LineView` gains `sentence: string | null` and `note: string | null`. `details` keeps its order: First detected, Noticed, Last checked, Last successful.
  - `HistoryWindow` adds `expected?: number | null` and `missed?: number | null`. Its `result` accepts `'partial' | 'missed' | 'mixed'`.
  - `Bar` becomes `{ tone: BarTone; range: string; result: string; counts: string | null; label: string }`, where `label` = `` `${range}: ${result}${counts ? `, ${counts}` : ''}` `` for aria.
  - `summarize` returns "All healthy".
  - The finding nouns are partner_pages "partner pages", watched_pages "watched pages", Meetup "groups" and Luma "pages".

- [ ] **Step 1: Write the failing tests:**
  - **Words and tones:**
    - working → Healthy/emerald, degraded → Degraded/amber, broken → Broken/rose
    - unconfirmed, not_checked and no_test_event → Unknown/amber
    - not_set_up → Not configured/stone
  - **Headline:** `summarize([])` with nothing wrong is `'All healthy'`.
  - **Degraded partner pages** with `latest {expected:15, reported:15, read:12}` → `sentence === "3 of 15 partner pages couldn't be checked in the latest run."`
  - **Broken watched pages** with `read 0, expected 22` → `"None of the 22 watched pages could be checked in the last 2 runs."`; with `read 5` → `"Only 5 of 22 watched pages could be checked in the latest run."`
  - **Broken link** → `"The last 2 checks couldn't import a test event."`
  - **Unknown (not checked) link:**
    - `last_checked_at` 01:40Z, `missed_runs 3` and `last_run_at` later → `"No result since Nov 4, 9:40 AM PHT. Checks normally run every hour. The last 3 didn't finish."`
    - With `last_run_at` ≤ `last_checked_at` → ends `"No check has started since then."`
    - The finding variant says "every 6 hours".
  - **Unconfirmed** → `"The latest check failed. Waiting for the next one to confirm."`; **no test event** → `"No recent event to test with."`
  - **Healthy rows:**
    - Healthy with `missed_runs 1` → note `"The latest check didn't finish; the one before passed."`
    - Healthy with a latest partial → note `"The latest run couldn't check 3 of 15 partner pages."`
  - **Missing times:** null `last_worked_at` → `"Last successful: not in the last 7 days"`, and null `last_checked_at` gives the same wording for "Last checked:".
  - **Old RPC shape:** a row without `latest`, `missed_runs` or `last_run_at` still renders, with a sentence that has no counts (for example "Some partner pages couldn't be checked in the latest run.").
  - **Popovers:**
    - Link window `{checks 5, passed 5, failed 0, expected 6, missed 1}` → `result 'Passed'`, `counts '6 checks: 5 passed, 1 didn\'t run'`.
    - Finding window `{checks 15, passed 12, failed 3, expected 15}` → `result 'Partly failed'`, `counts '12 of 15 pages checked: 3 couldn\'t be checked'`.
    - `mixed` → tone `partial`.
    - Over every bar of a fixture covering all tones, `label` matches none of `/Healthy|Degraded|Broken|Unknown|Not configured|Noticed|Updated/`.
- [ ] **Step 2: See them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: See them pass.**
- [ ] **Step 5: Commit** `feat(pwa): say what each /status problem affects`

### Task 7: PWA page: popover bars and new rows

**Files:**
- Modify: `apps/pwa/src/pages/status.astro`

**Interfaces:**
- Consumes: the `LineView`, `Bar` and `summarize` output from Task 6.

- [ ] **Step 1: Render the row content:**
  - `sentence` under the label on problem rows;
  - `note` in muted text on healthy rows;
  - the details list, joined with " · " on Healthy rows.
- [ ] **Step 2: Render each bar** as `<button type="button" class="bar bar-{tone}" popovertarget={id} aria-label={label}>` plus `<div popover id={id} class="bar-pop">` with three lines (range, result, counts).
  - `id` = `` `w-${source}-${line}-${i}` ``.
  - Positioning: `anchor-name`/`position-anchor` set inline per pair under `@supports (anchor-name: --a)`, with `position-area: top`; otherwise the UA's centred popover.
  - Drop `title`. Add `.bar-partial` and `.bar-missed` styles (amber, and the `none` tint with a dashed inset), and update the legend.
- [ ] **Step 3: Update the footer copy:** "Tap or hover a bar for its checks.", the cadence sentence, and the Noticed sentence.
- [ ] **Step 4: Verify.**
  - `pnpm --filter pwa test` and `pnpm --filter pwa build` pass.
  - Start `cd apps/pwa && pnpm exec astro dev --port 4400` against the local DB, seeded with Task 4 fixtures, or against production (read-only RPCs).
  - Take headless Chrome screenshots at 1280 px and in a 390 px iframe, with a fresh `--user-data-dir`.
  - Confirm that a popover opens on click and that the page source has no `<script>` of its own.
- [ ] **Step 5: Commit** `feat(pwa): make /status bars inspectable`

### Task 8: Admin health page

**Files:**
- Create: `apps/admin/src/lib/health-report.ts`, `apps/admin/src/pages/health.astro`
- Modify: the admin nav (where `scrape.astro` and `orgs.astro` are linked)
- Test: `apps/admin/tests/health-report.test.ts` (`pnpm --filter @cebby/admin test`)

**Interfaces:**
- Consumes: `public.finding_targets()` and the `service_health_events` rows (service role).
- Produces:
  - `buildHealthReport(input: { targets: Target[]; findingRows: HealthRow[]; linkRows: HealthRow[]; runRows: HealthRow[]; now: Date }): LineReport[]`
  - `LineReport = { source; line; windowStart: string | null; expected: number | null; unread: { accountId; name: string | null; code: string; detail: string | null; at: string }[]; notReported: { accountId; name }[]; linkFailures: { at; status; failure: string | null; attempts: { url; outcome; reason? }[] }[]; missedLinkRuns: string[] }`
  - The latest finding window is the newest window at least an hour old.

- [ ] **Step 1: Write the failing tests:**
  - With targets [a, b, c] and window rows a read, b unread `token_rejected`, the report gives `unread` = [b, with its name and code], `notReported` = [c] and `expected` = 3.
  - A row without `read_error` shows code `'unknown'` and detail = its `message`.
  - A link run at 10:40 with no result gives `missedLinkRuns` = ['10:40…'].
  - A failed link row lists its attempts.
- [ ] **Step 2: See them fail.**
- [ ] **Step 3: Implement the lib, then the page.**
  - Two queries, each kept under the 1000-row cap:
    - finding rows from the last 24 h (`metadata->>page_read` not null);
    - `source in ('link-check','scheduled-run')` from the last 24 h.
  - Plus the `finding_targets` RPC.
  - Times in PHT.
- [ ] **Step 4: Verify.** The tests pass. Run `pnpm --filter @cebby/admin build`, then start the admin app on another port against production (it is read-only) and screenshot `/health`.
- [ ] **Step 5: Commit** `feat(admin): show why /status checks fail`

### Task 9: Docs, production check, PR

**Files:**
- Modify:
  - `ARCHITECTURE.md` ("Health checks and `/status`")
  - `docs/superpowers/specs/2026-11-03-scraper-health-status-design.md` §6: add a note pointing at the new routine text
  - the new spec's Status line
  - project memory

- [ ] **Step 1: Verify against production data.**
  - Export with read-only queries: the last 7 days of `service_health_events` for the 4 buckets (excluding `message`, which stays local anyway), plus `accounts` and the `account_secrets` token presence. Load them into a scratch schema in the local DB and run the new functions at `p_now` = now and = 2026-11-04 01:44Z.
  - Expect partner pages `degraded`, Meetup `degraded`, watched `broken`, Luma `working` and the 4 link lines `working`, with the 18:00Z Eventbrite and Facebook link windows at `checks 5`, `expected null`.
- [ ] **Step 2: Run everything.**
  - Every service's Deno tests, `pnpm --filter pwa test` and `build`, admin test and build, and pgTAP. All green.
- [ ] **Step 3: Commit the docs,** push, and open the PR.
  - The PR body goes to the outbox (`outbox add --title "PR: /status diagnostics" --subject … --to pr:getcebby/cebby:feat/status-diagnostics`). It covers post-deploy checks from spec §10.2, the grok routine text and the account fixes.
  - Run `codex-review-wait <pr-url>` in the background and address its findings.
