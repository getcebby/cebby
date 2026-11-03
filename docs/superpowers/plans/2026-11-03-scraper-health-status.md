# Scraper Health Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Judge each scraper by a real attempt, publish the result at `www.getcebby.com/status`, and let a grok-bot routine read it so silent failures reach the user.

**Architecture:**
- **Link checks.** An hourly pg_cron job posts a few real sample URLs to each source's existing `*-scraper` Edge Function in a new check-only mode. The function fetches and parses the page, saves nothing, and records one `service_health_events` row (`source = 'link-check'`).
- **Finding checks.** The existing 6-hourly crons add `metadata.line` and `metadata.page_read` to the row they already write for each account.
- **Status.** One SQL function turns those rows into per-line states. One anon-callable wrapper exposes only public fields, and an Astro SSR page renders them as plain text.

**Tech Stack:**
- Supabase Postgres: pg_cron, pg_net, pgTAP via `supabase test db`.
- Deno Edge Functions, tested with `jsr:@std/testing` and `jsr:@std/expect`.
- Astro 5 SSR on Cloudflare, tested with vitest.
- Supabase CLI 3.0.0, run via `npx -y supabase@3.0.0`.

**Spec:** `docs/superpowers/specs/2026-11-03-scraper-health-status-design.md`

## Global Constraints

- **Merges deploy to production.** Merging anything under `services/**` to main deploys every service's functions and runs `db push` on production. There is no staging.
- **Migration timestamps** must sort after production's latest, `20261026020000`. Use `20261103010000`, `20261103020000` and `20261104010000`, as given per task.
- **The user reviews every PR before merge.** Stop at a ready PR, and merge only when the user says so for that PR.
- **Commits:** no AI attribution of any kind. The subject is imperative, about 50 characters, and may use a conventional prefix. Each body paragraph is a single line, with no hard wrapping.
- **CI:** stays pinned to Supabase CLI `3.0.0`. Never use `latest`.
- **Facebook load:** at most one link check per hour against Facebook, using the scraper's existing browser-like headers.
- **The public page** shows no event names, account names, URLs or error text, and `anon` must never read `service_health_events`.
- **State strings** are fixed: `working`, `broken`, `not_checked`, `no_test_event`, `not_set_up`.
- **Page words** are fixed: "Working", "Broken since …", "Not checked recently", "No test event available", "Not set up", "All working", "N problems".
- **Staleness limits:** link lines 3 hours, finding lines 13 hours. Lookback 7 days.
- **Times on the page** are Philippine time, labelled `PHT`.

## Review Focus

1. **Anon calling internal SQL functions.** Supabase grants EXECUTE on new `public` functions to `anon` by default. If `run_link_checks()` stayed callable over `/rest/v1/rpc`, anyone could make Cebby fire outbound requests. Only `get_scraper_status()` may be anon-callable, and `service_health_events` stays unreadable. Owner: Tasks 8 and 9.
2. **The status RPC errors or returns no rows.** The page must say "Status unavailable" with HTTP 503 and must never render "All working". Owner: Tasks 11 and 12.
3. **A check body carrying a foreign URL** (`https://evil.example/...`). A probe must never fetch any host but its own source's: it either skips the URL or canonicalizes it onto the source host. Owner: Tasks 2 to 5.
4. **Graph API errors.** HTTP 400 with `{"error":…}`, a body with no `data`, or a failure on page 2 of pagination must throw, not return `[]`. Today they read as "0 events, success". Owner: Task 7.
5. **Time formatting on Cloudflare.** ICU puts U+202F before "PM", and the server runs in UTC. `formatPht` must output plain spaces and Manila time. Owner: Task 11.

---

## PR A: checks, status data and schedules

Branch: keep working on `docs/scraper-health-status`, which already has the spec and plan commits. Rename it to `feat/scraper-health-checks` before opening the PR, so it lands as one PR with its docs.

Shared commands:
- Facebook, Luma, Meetup and Eventbrite tests: `cd services/<svc> && deno test --no-config --node-modules-dir=none --import-map=supabase/functions/import_map.json tests/`. Eventbrite's script also passes `--allow-read=tests/fixtures`.
- Core tests: `cd services/core && deno test --no-config --node-modules-dir=none tests/`
- Local DB: `cd services/core && SUPABASE_DB_SEED_ENABLED=false npx -y supabase@3.0.0 db start`. This applies all migrations; verified 2026-11-03. Disabling the seed is required, because the v1 seed file fails on the v2 schema. After adding a migration, re-apply with `SUPABASE_DB_SEED_ENABLED=false npx -y supabase@3.0.0 db reset --no-seed`.
- SQL tests: `cd services/core && npx -y supabase@3.0.0 test db supabase/tests/`
- Stop the local DB when done: `npx -y supabase@3.0.0 stop --no-backup`.

### Task 1: Core health-check logic

**Files:**
- Create: `services/core/supabase/shared/health-checks.ts` (pure, with no runtime imports except types)
- Create: `services/core/supabase/shared/link-check-endpoint.ts` (thin wiring that records the result and responds)
- Modify: `services/core/supabase/shared/service-health.ts` (export the `ServiceHealthEvent` interface)
- Test: `services/core/tests/health_checks_test.ts`

**Interfaces:**
- Produces (`health-checks.ts`):
  - `type LinkProbe = { kind: 'skip'; reason: string } | { kind: 'parsed'; fields: CheckedFields }`
  - `interface CheckedFields { name: string | null; start_time: string | null; location: string | null }`
  - `interface LinkCheckSample { url: string; expect_location: boolean }`
  - `interface LinkCheckAttempt { url: string; outcome: 'ok' | 'skipped' | 'broken'; reason?: string }`
  - `interface LinkCheckResult { status: 'passed' | 'failed' | 'no_sample'; attempts: LinkCheckAttempt[] }`
  - `parseLinkCheckSamples(value: unknown): LinkCheckSample[] | null`. Returns null when the value is not an array. Otherwise it keeps only well-formed items, at most 3.
  - `judgeFields(fields: CheckedFields, expectLocation: boolean): string | null`. Returns a failure reason, or null when the fields are fine.
  - `runLinkCheck(samples: LinkCheckSample[], probe: (url: string) => Promise<LinkProbe>): Promise<LinkCheckResult>`
  - `linkCheckHealthEvent(bucket: ServiceHealthBucket, result: LinkCheckResult): ServiceHealthEvent`
  - `type FindingLine = 'partner_pages' | 'watched_pages' | 'finding'`
  - `interface FindingRun { line: FindingLine | null; pageRead: boolean | null }`
  - `findingMetadata(run: FindingRun, opts?: { crashed?: boolean }): Record<string, unknown>`
- Produces (`link-check-endpoint.ts`): `handleLinkCheck(bucket: ServiceHealthBucket, body: unknown, probe: (url: string) => Promise<LinkProbe>): Promise<Response>`

- [ ] **Step 1: Write the failing tests** in `services/core/tests/health_checks_test.ts`. Use `describe`/`it` from `jsr:@std/testing/bdd` and `expect` from `jsr:@std/expect`.

```ts
// parseLinkCheckSamples
expect(parseLinkCheckSamples('nope')).toBeNull();
expect(parseLinkCheckSamples([{ url: 'a', expect_location: true }, { url: 1 }, { url: 'b', expect_location: false },
  { url: 'c', expect_location: false }, { url: 'd', expect_location: false }]))
  .toEqual([{ url: 'a', expect_location: true }, { url: 'b', expect_location: false }, { url: 'c', expect_location: false }]);

// judgeFields
expect(judgeFields({ name: 'X', start_time: '2026-11-21T01:00:00Z', location: null }, false)).toBeNull();
expect(judgeFields({ name: '  ', start_time: '2026-11-21T01:00:00Z', location: 'A' }, false)).toBe('missing title');
expect(judgeFields({ name: 'X', start_time: 'not a date', location: 'A' }, false)).toBe('missing start time');
expect(judgeFields({ name: 'X', start_time: '2026-11-21T01:00:00Z', location: null }, true)).toBe('missing location');

// runLinkCheck — probe outcomes keyed by url
const ok = { kind: 'parsed', fields: { name: 'X', start_time: '2026-11-21T01:00:00Z', location: 'A' } };
// passes on first ok, stops probing
//   samples [a(ok), b] → { status: 'passed', attempts: [{ url: 'a', outcome: 'ok' }] }
// skip is not a failure
//   samples [a(skip 'gone (HTTP 404)'), b(ok)] → passed, attempts [{a, skipped, reason: 'gone (HTTP 404)'}, {b, ok}]
// two broken → failed (probe throwing counts as broken with the error message as reason)
//   samples [a(throws 'HTTP 500'), b(parsed but name ''), c(ok)] → failed, attempts length 2, c never probed
// one broken then out of samples → failed
//   samples [a(skip), b(throws)] → failed
// nothing usable → no_sample
//   samples [] → { status: 'no_sample', attempts: [] }; samples [a(skip), b(skip)] → no_sample

// linkCheckHealthEvent
expect(linkCheckHealthEvent('meetup', { status: 'failed', attempts: [{ url: 'u', outcome: 'broken', reason: 'HTTP 500' }] }))
  .toEqual({ bucket: 'meetup', source: 'link-check', status: 'error', fingerprint: 'link_check_failed',
    message: 'HTTP 500', metadata: { line: 'link', attempts: [{ url: 'u', outcome: 'broken', reason: 'HTTP 500' }] } });
// passed → status 'success', fingerprint 'link_check_passed', message null
// no_sample → status 'warning', fingerprint 'link_check_no_sample', message 'no usable test event'

// findingMetadata
expect(findingMetadata({ line: null, pageRead: null })).toEqual({});
expect(findingMetadata({ line: 'finding', pageRead: null })).toEqual({});
expect(findingMetadata({ line: 'finding', pageRead: true })).toEqual({ line: 'finding', page_read: true });
expect(findingMetadata({ line: 'watched_pages', pageRead: null }, { crashed: true })).toEqual({ line: 'watched_pages', page_read: false });
expect(findingMetadata({ line: 'partner_pages', pageRead: true }, { crashed: true })).toEqual({ line: 'partner_pages', page_read: true });
```

- [ ] **Step 2: Run the tests and confirm they fail.** Run the core test command. Expected: FAIL, with module-not-found for `health-checks.ts`.

- [ ] **Step 3: Implement `health-checks.ts`.**
  - **`runLinkCheck` loop:** walk the samples in order.
    - `skip` records `skipped` and continues.
    - `parsed` runs `judgeFields`. Null means `ok`, so return `passed`. A reason means `broken`.
    - A thrown error is `broken`, with `err.message` as the reason.
    - Stop with `failed` once 2 attempts are `broken`.
    - After the loop, any `broken` means `failed`; otherwise `no_sample`.
  - **`linkCheckHealthEvent` message:** for `failed`, use the first broken reason. Severity is left to `recordServiceHealthEvent`'s default.
  - Import `ServiceHealthBucket` and `ServiceHealthEvent` with `import type` only. Then the module never loads `client.ts`, which throws without env.

- [ ] **Step 4: Implement `handleLinkCheck` in `link-check-endpoint.ts`.**
  1. `parseLinkCheckSamples((body as { samples?: unknown })?.samples)`. On null, respond 400 with `{ error: 'samples must be an array' }`.
  2. `runLinkCheck`, then `recordServiceHealthEvent(linkCheckHealthEvent(bucket, result))`.
  3. Respond 200 with JSON `result`.

- [ ] **Step 5: Run the tests and confirm they pass.** Run the core test command. Expected: all `health_checks_test.ts` cases PASS.

- [ ] **Step 6: Commit**

```bash
git add services/core/supabase/shared/health-checks.ts services/core/supabase/shared/link-check-endpoint.ts services/core/supabase/shared/service-health.ts services/core/tests/health_checks_test.ts
git commit -m "feat(health): add link-check and finding-run logic"
```

### Task 2: Facebook link probe and check mode

**Files:**
- Modify: `services/facebook/supabase/functions/_shared/fb-event-scraper/network.ts`. Add `export class HttpStatusError extends Error { constructor(message: string, readonly status: number) }`. `fetchEvent` throws it on a non-OK response, and the message text stays exactly as it is today.
- Create: `services/facebook/supabase/functions/_shared/link-probe.ts`
- Modify: `services/facebook/supabase/functions/fb-scraper/index.ts`. Parse the body once. When `body.mode === 'check'`, return `handleLinkCheck('facebook', body, probeFacebookEventPage)` before any ingest code runs.
- Test: `services/facebook/tests/link_probe_test.ts`

**Interfaces:**
- Consumes: `LinkProbe` and `handleLinkCheck` from Task 1. `validateAndFormatUrl` and `parseEventHtml` from `fb-event-scraper`.
- Produces: `probeFacebookEventPage(url: string): Promise<LinkProbe>`

- [ ] **Step 1: Write the failing tests.** Stub `globalThis.fetch` with `stub` from `jsr:@std/testing/mock`. Reuse the page-building approach of `eventPage()` in `tests/fb_event_scraper_test.ts`, either by exporting a helper from a new `tests/helpers.ts` or by copying it.
  - `'https://www.facebook.com/events/2552868275211222/'` with a 200 page from the builder (in person, with a place). The result is `parsed`, with `fields.name` equal to the builder's name, `fields.start_time` equal to the ISO time of the builder's `start_timestamp`, and `fields.location` equal to the place name. The stub was called once, with a URL starting `https://www.facebook.com/events/2552868275211222`.
  - A stub returning 404 gives `{ kind: 'skip', reason: 'gone (HTTP 404)' }`, and 410 gives `'gone (HTTP 410)'`.
  - A stub returning 500 rejects with a message containing `HTTP 500`.
  - A 200 page without the time data (as in the existing "throws when no end-time data" test) rejects.
  - `'https://evil.example/whatever'` gives `{ kind: 'skip', reason: 'not a Facebook event URL' }`, and the stub was never called.
  - `'https://evil.example/facebook.com/events/2552868275211222'` is canonicalized: if the stub is called at all, it is with a URL whose host is `www.facebook.com`.

- [ ] **Step 2: Run the Facebook tests and confirm they fail.** Expected: FAIL, because `link-probe.ts` is not found.

- [ ] **Step 3: Implement `probeFacebookEventPage` and `HttpStatusError`.**
  - If `validateAndFormatUrl` throws, skip with `'not a Facebook event URL'`.
  - `fetchEvent(canonical)`: on `HttpStatusError` with 404 or 410, skip with `` `gone (HTTP ${status})` ``. Any other error propagates.
  - Parse with `parseEventHtml`. The fields are `{ name: event.name, start_time: new Date(event.startTimestamp * 1000).toISOString(), location: event.location?.name ?? null }`.

- [ ] **Step 4: Add check mode to `fb-scraper/index.ts`.** Read `const body = await req.json()` once. Branch on `body?.mode === 'check'` first. Otherwise destructure `{ url, id }` from `body` as today.

- [ ] **Step 5: Run the Facebook tests and confirm they pass.** Expected: PASS, including the existing 12 tests.

- [ ] **Step 6: Commit**

```bash
git add services/facebook/supabase/functions/_shared/fb-event-scraper/network.ts services/facebook/supabase/functions/_shared/link-probe.ts services/facebook/supabase/functions/fb-scraper/index.ts services/facebook/tests/
git commit -m "feat(facebook): add check-only mode to fb-scraper"
```

### Task 3: Luma link probe and check mode

**Files:**
- Modify: `services/luma/supabase/functions/_shared/lumautils.ts`. Extract `export function parseLumaEventHtml(html: string): LumaEvent | null` from the body of `fetchLumaEvent`, which then calls it. Add `probeLumaEventPage`.
- Modify: `services/luma/supabase/functions/luma-scraper/index.ts` (check-mode branch, the same shape as Task 2 step 4).
- Modify: `services/luma/package.json`. Set `"test"` to the shared Deno test command.
- Test: `services/luma/tests/link_probe_test.ts`

**Interfaces:**
- Consumes: `LinkProbe` and `handleLinkCheck` from Task 1.
- Produces: `parseLumaEventHtml(html: string): LumaEvent | null` and `probeLumaEventPage(url: string): Promise<LinkProbe>`

- [ ] **Step 1: Write the failing tests.** Use a synthetic page `<script id="__NEXT_DATA__" type="application/json">…</script>` whose `props.pageProps.initialData.data.event` has the fields `mapNextDataEventToLumaEvent` reads. Stub `fetch`.
  - `'https://luma.com/h285dxy6'` with a 200 event page gives `parsed`, where `fields` equals the event's name, ISO start time and location string. The stub's URL host is `luma.com`.
  - HTTP 404 gives `{ kind: 'skip', reason: 'gone (HTTP 404)' }`.
  - HTTP 200 with `pageProps.status: 404` gives `{ kind: 'skip', reason: 'gone (page not found)' }`. HTTP 200 with `initialData: null` gives the same.
  - HTTP 200 with no `__NEXT_DATA__` rejects with `'no event data on page'`.
  - `'https://evil.example/x'` either never calls fetch or calls it only with host `luma.com`.

- [ ] **Step 2: Run the Luma tests and confirm they fail.** Expected: FAIL, because of the missing exports.

- [ ] **Step 3: Implement the extraction and the probe.**
  - Always fetch `pathToCanonicalUrl(normalizeLumaPath(url))` with the module's `HTML_HEADERS`. 404 and 410 skip. Any other non-OK status throws `` `HTTP ${status}` ``.
  - A not-found page (`pageProps.status === 404`, or `initialData === null`) skips.
  - `parseLumaEventHtml` returning null throws `'no event data on page'`.
  - The fields are `{ name, start_time, location }` from the `LumaEvent`.
  - `fetchLumaEvent`'s behavior is unchanged.

- [ ] **Step 4: Add the check-mode branch to `luma-scraper/index.ts`.**

- [ ] **Step 5: Run the Luma tests and confirm they pass.** Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add services/luma/supabase/functions/_shared/lumautils.ts services/luma/supabase/functions/luma-scraper/index.ts services/luma/package.json services/luma/tests/
git commit -m "feat(luma): add check-only mode to luma-scraper"
```

### Task 4: Meetup link probe and check mode

**Files:**
- Modify: `services/meetup/supabase/functions/_shared/meetuputils.ts`. Extract `export function parseMeetupEventHtml(html: string, normalizedEventUrl: string, opts: { allowPast: boolean }): MeetupEvent | null` from `fetchMeetupEvent`, which calls it with `allowPast: false` so its behavior is unchanged. Add `probeMeetupEventPage`.
- Modify: `services/meetup/supabase/functions/meetup-scraper/index.ts` (check-mode branch).
- Modify: `services/meetup/package.json` (`"test"` script, as in Task 3).
- Test: `services/meetup/tests/link_probe_test.ts`

**Interfaces:**
- Consumes: Task 1's `LinkProbe` and `handleLinkCheck`, and the existing `normalizeMeetupEventUrl`.
- Produces: `parseMeetupEventHtml(...)` as above, and `probeMeetupEventPage(url: string): Promise<LinkProbe>`

- [ ] **Step 1: Write the failing tests.** Use a synthetic `__NEXT_DATA__` with `pageProps.__APOLLO_STATE__` holding an `Event:<id>` entity (title, dateTime, group ref) and a `Group` entity. Stub `fetch`.
  - An upcoming event at `'https://www.meetup.com/aws-sbg-at-national-university-cebu-campus/events/317074920/'` gives `parsed`, with the title, the ISO `dateTime`, and the location from `buildLocationString`.
  - **A past event (dateTime in 2025) gives `parsed`.** The probe must not drop past events.
  - `parseMeetupEventHtml(samePastHtml, url, { allowPast: false })` gives `null`, which preserves today's behavior.
  - HTTP 404 gives `{ kind: 'skip', reason: 'gone (HTTP 404)' }`.
  - `'https://evil.example/g/events/1/'` gives `{ kind: 'skip', reason: 'not a Meetup event URL' }`, and fetch is never called.
  - A 200 page with no Apollo state rejects with `'no event data on page'`.

- [ ] **Step 2: Run the Meetup tests and confirm they fail.**

- [ ] **Step 3: Implement the extraction and the probe.** Follow the same rules as Task 3 step 3. A null from `normalizeMeetupEventUrl` means skip before any fetch.

- [ ] **Step 4: Add the check-mode branch to `meetup-scraper/index.ts`.**

- [ ] **Step 5: Run the Meetup tests and confirm they pass.**

- [ ] **Step 6: Commit**

```bash
git add services/meetup/supabase/functions/_shared/meetuputils.ts services/meetup/supabase/functions/meetup-scraper/index.ts services/meetup/package.json services/meetup/tests/
git commit -m "feat(meetup): add check-only mode to meetup-scraper"
```

### Task 5: Eventbrite link probe and check mode

**Files:**
- Modify: `services/eventbrite/supabase/functions/_shared/eventbriteutils.ts` (add `probeEventbriteEventPage`).
- Modify: `services/eventbrite/supabase/functions/eventbrite-scraper/index.ts` (check-mode branch, before URL parsing).
- Test: `services/eventbrite/tests/link_probe_test.ts` (reuse the existing fixtures in `tests/fixtures`).

**Interfaces:**
- Consumes: Task 1's `LinkProbe` and `handleLinkCheck`, plus `parseEventbriteEventUrl` and `parseEventbriteEventPage`.
- Produces: `probeEventbriteEventPage(url: string): Promise<LinkProbe>`

- [ ] **Step 1: Write the failing tests** with a stubbed `fetch` and the existing fixture HTML.
  - A single-event fixture gives `parsed`, with the fixture's name, `start_time` and `location`.
  - The series-parent fixture gives `{ kind: 'skip', reason: 'series page' }`.
  - HTTP 404 gives `gone (HTTP 404)`. HTTP 503 rejects with `HTTP 503`.
  - `'https://evil.example/e/x-123'` gives `{ kind: 'skip', reason: 'not an Eventbrite event URL' }`, and fetch is never called.

- [ ] **Step 2: Run the Eventbrite tests and confirm they fail.**

- [ ] **Step 3: Implement the probe.** Fetch `parsed.canonicalUrl` with `HTML_HEADERS` and `redirect: 'follow'`. 404 and 410 skip. Any other non-OK status throws. A null parse throws `'no event data on page'`.

- [ ] **Step 4: Add the check-mode branch to `eventbrite-scraper/index.ts`.**

- [ ] **Step 5: Run the Eventbrite tests and confirm they pass.** Expected: the new tests and the existing ones all PASS.

- [ ] **Step 6: Commit**

```bash
git add services/eventbrite/supabase/functions/_shared/eventbriteutils.ts services/eventbrite/supabase/functions/eventbrite-scraper/index.ts services/eventbrite/tests/link_probe_test.ts
git commit -m "feat(eventbrite): add check-only mode to eventbrite-scraper"
```

### Task 6: Luma and Meetup finding signals

**Files:**
- Modify: `services/luma/supabase/functions/_shared/lumautils.ts`. `fetchCalendarEventStubs` and `fetchUserProfileEventStubs` return `{ pageRead: boolean; stubs: LumaEventStub[] }`. Add `listEventsForLumaPath`. `fetchEventsForLumaPath` becomes `(await listEventsForLumaPath(path)).events`, so `scripts/probe.ts` and `scripts/test-ingest-v2.ts` keep working.
- Modify: `services/luma/supabase/functions/retrieve-and-sync-to-db-luma-events/index.ts`
- Modify: `services/meetup/supabase/functions/_shared/meetuputils.ts`. Add `listEventsForMeetupGroup`, and make `fetchEventsForMeetupGroup` its `.events` wrapper.
- Modify: `services/meetup/supabase/functions/retrieve-and-sync-to-db-meetup-events/index.ts`
- Test: `services/luma/tests/listing_test.ts` and `services/meetup/tests/listing_test.ts`

**Interfaces:**
- Consumes: `FindingRun` and `findingMetadata` from Task 1.
- Produces:
  - `listEventsForLumaPath(path: string): Promise<{ pageRead: boolean; events: LumaEvent[] }>`
  - `listEventsForMeetupGroup(urlname: string): Promise<{ pageRead: boolean; events: MeetupEvent[] }>`

- [ ] **Step 1: Write the failing listing tests** with a stubbed `fetch`.
  - **Luma calendar:**
    - A page with `initialData.data.has_upcoming_events: false` gives `{ pageRead: true, events: [] }`.
    - HTTP 500 gives `{ pageRead: false, events: [] }`.
    - HTTP 200 without `__NEXT_DATA__` gives `pageRead: false`.
  - **Luma user path** (`'user/princejohn'`):
    - A profile with `pageProps.status: 404` gives `pageRead: false`.
    - A profile with a user, followed by an api2 response `{ entries: [] }`, gives `pageRead: true`.
  - **Meetup group:**
    - HTTP 200 with Apollo state and no Event entities gives `{ pageRead: true, events: [] }`.
    - HTTP 403 gives `pageRead: false`.
    - HTTP 200 without `__NEXT_DATA__` gives `pageRead: false`.

- [ ] **Step 2: Run the Luma and Meetup tests and confirm they fail.**

- [ ] **Step 3: Implement `pageRead`.**
  - **Luma calendar:** true when the HTML was fetched and `initialData.data` exists.
  - **Luma user:** true when the user was found and the api2 response was OK.
  - **Meetup:** true when the HTML was fetched and `__APOLLO_STATE__` exists.
  - Split Meetup's "no state" case out of `extractEventStubsFromGroupPage` to get this.

- [ ] **Step 4: Record the finding metadata in both crons.**
  - `processCalendar` and `processGroup` take `run: FindingRun`, initialized in `Deno.serve` as `{ line: 'finding', pageRead: null }`. They set `run.pageRead` from the listing result.
  - The success or skip row's `metadata` becomes `{ ingested, ...findingMetadata(run) }`.
  - The catch row's `metadata` becomes `findingMetadata(run, { crashed: true })`.
  - The status, fingerprint and message of every row stay as they are today, so the old watchdog view behaves identically.

- [ ] **Step 5: Run the Luma and Meetup tests and confirm they pass.**

- [ ] **Step 6: Commit**

```bash
git add services/luma services/meetup
git commit -m "feat(health): record listing reads in Luma and Meetup crons"
```

### Task 7: Facebook finding signals (partner and watched)

**Files:**
- Create: `services/facebook/supabase/functions/_shared/graph-events.ts`. Move `retrieveEventsFromFacebook` here under the new name `fetchGraphEvents`, and make it throw instead of swallowing errors. Delete the old function from `_shared/events.ts`; the cron is its only caller.
- Modify: `services/facebook/supabase/functions/retrieve-and-sync-to-db-events/index.ts`
- Test: `services/facebook/tests/graph_events_test.ts`

**Interfaces:**
- Consumes: `FindingRun` and `findingMetadata` from Task 1. `FacebookEvent` from `_shared/types.ts`.
- Produces: `fetchGraphEvents(url: string): Promise<FacebookEvent[]>`, which follows `paging.next`.

- [ ] **Step 1: Write the failing tests** with a stubbed `fetch`.
  - Page 1 `{ data: [e1], paging: { next: 'https://graph.facebook.com/p2' } }` and page 2 `{ data: [e2] }` resolve to `[e1, e2]`.
  - HTTP 400 with `{ error: { message: 'Error validating access token' } }` rejects with a message containing `Error validating access token`.
  - HTTP 200 with `{ error: { message: 'x' } }` rejects. HTTP 200 with `{}` (no `data` array) rejects.
  - Page 1 OK, then page 2 at HTTP 500, rejects. It must not return the partial `[e1]`.

- [ ] **Step 2: Run the Facebook tests and confirm they fail.**

- [ ] **Step 3: Implement `fetchGraphEvents`.** Throw `` `Graph API: ${error.message ?? 'HTTP ' + status}` `` when the response is not OK, has `error`, or has no `data` array.

- [ ] **Step 4: Wire the lines in the cron.**
  - `processEvents(account, run: FindingRun)`, with `run` initialized as `{ line: null, pageRead: null }`.
  - **Token path:** set `run.line = 'partner_pages'`. Wrap `fetchGraphEvents` in try/catch. On success, `run.pageRead = true`. On failure, log a warning, set `run.pageRead = false`, and `return []`. Returning `[]` keeps today's success row, so the old watchdog is unaffected.
  - **Public-scrape path:** set `run.line = 'watched_pages'` only after the `discovery_path` and URL guards pass.
    - When `scrapeFbEventList` returns, `run.pageRead = true`.
    - Both catch branches (the soft `watch_no_events` and the hard `watch_list_failed`) set `run.pageRead = false`. Their existing rows stay as they are.
  - **Final row:** `metadata: { ingested, ...findingMetadata(run) }`. **Catch row:** `metadata: findingMetadata(run, { crashed: true })`.

- [ ] **Step 5: Run the Facebook tests and type-check the cron.**
  - Run the Facebook test command. Expected: PASS.
  - Run `cd services/facebook && deno check --no-config --import-map=supabase/functions/import_map.json supabase/functions/retrieve-and-sync-to-db-events/index.ts`. Expected: no new errors. The pre-existing error at `index.ts:182` (on main) may remain, so compare against main.

- [ ] **Step 6: Commit**

```bash
git add services/facebook
git commit -m "feat(health): split Facebook finding into partner and watched lines"
```

### Task 8: Status rules in SQL

**Files:**
- Create: `services/core/supabase/migrations/20261103010000_scraper_status.sql`
- Test: `services/core/supabase/tests/scraper_status_test.sql` (pgTAP)

**Interfaces:**
- Consumes: the row shapes from Tasks 1, 6 and 7.
  - **Link rows:** `bucket = <source>`, `source = 'link-check'`, and `status` of `success`, `error` (a failure) or `warning` (no sample).
  - **Finding rows:** `bucket = <source>` with `metadata ? 'page_read'`, and `metadata->>'line'` naming the line.
- Produces:
  - `public.scraper_status_at(p_now timestamptz) RETURNS TABLE(sort_order int, source text, source_label text, line text, line_label text, state text, since timestamptz, last_worked_at timestamptz, last_checked_at timestamptz)`. Internal only.
  - `public.get_scraper_status() RETURNS` the same table, as `SECURITY DEFINER SET search_path = public`. It returns `scraper_status_at(now())` ordered by `sort_order`. Only it is granted to `anon` and `authenticated`.

**Line catalogue** (VALUES inside the function):

| sort_order | source | source_label | line | line_label | kind |
|---|---|---|---|---|---|
| 1 | facebook | Facebook | link | Importing from a link | link |
| 2 | facebook | Facebook | partner_pages | Partner pages | finding |
| 3 | facebook | Facebook | watched_pages | Watched pages | finding |
| 4 | meetup | Meetup | link | Importing from a link | link |
| 5 | meetup | Meetup | finding | Finding new events | finding |
| 6 | luma | Luma | link | Importing from a link | link |
| 7 | luma | Luma | finding | Finding new events | finding |
| 8 | eventbrite | Eventbrite | link | Importing from a link | link |
| 9 | eventbrite | Eventbrite | finding | Finding new events | not_set_up |

**Results per line.** Only rows with `occurred_at` in `(p_now - 7 days, p_now]` count.
- **Link line:** each row is one result: `pass` (success), `fail` (error) or `no_sample` (warning). `at = occurred_at`.
- **Finding line:** group the rows into 6-hour windows by `floor(extract(epoch from occurred_at) / 21600)`. A window is `pass` when `count(*) FILTER (WHERE page_read) * 2 >= count(*)`, otherwise `fail`. The window's `at` is `max(occurred_at)`.

**State algorithm** (results newest first: r1, r2, …; `stale` is 3h for link lines and 13h for finding lines):

```
not_set_up kind            → state not_set_up, since/last_* null
no results                 → not_checked, since null
r1.at < p_now - stale      → not_checked, since = r1.at + stale
r1 = no_sample             → no_test_event, since = at of the oldest result in the leading run of no_sample
r1 = pass                  → working, since null
r1 = fail and r2 = fail    → broken, since = at of the oldest result in the leading run of fail
otherwise                  → working (single blip), since null
last_worked_at = max(at) where pass;  last_checked_at = r1.at
```

- [ ] **Step 1: Write the failing pgTAP tests.**
  - Set `p_now = '2026-11-03 12:00+00'`. Insert rows into `service_health_events` with explicit `occurred_at`. Use `BEGIN … ROLLBACK`.
  - Delete any existing rows first, inside the transaction. The bootstrap migration seeds a few.
  - Assert on `scraper_status_at(p_now)`:
    1. Meetup link: pass at 10:40, fail at 11:40, so `working`, with `last_worked_at` = 10:40.
    2. Meetup link: pass at 09:40, fail at 10:40, fail at 11:40, so `broken`, since 10:40.
    3. Luma link: a single pass at 08:00 (4h old), so `not_checked`, since 11:00.
    4. Facebook link: warning at 10:40 and 11:40, so `no_test_event`, since 10:40.
    5. Eventbrite link: no rows, so `not_checked`, since null.
    6. Luma finding:
       - Window 06:00–12:00 has 2 rows with `page_read` true and 1 false, so it passes.
       - Window 00:00–06:00 has 0 of 3 true, so it fails.
       - Overall `working`, `last_worked_at` = the max time in the 06:00 window.
    7. Facebook watched pages: the two latest windows are both 0 of 2 true, so `broken`, since = the older window's max time.
    8. Meetup finding: 2 of 4 true in the latest window gives `working`, because exactly half passes.
    9. Rows without `page_read` (FB `account_skipped`) are ignored. A window containing only those rows produces no result, so with nothing else the partner line is `not_checked`.
    10. Facebook partner pages: the latest window is 14h old, so `not_checked`.
    11. Eventbrite finding is `not_set_up`, even when rows exist.
    12. A link row 8 days old is ignored, giving `not_checked` with since null.
  - **Grants:**
    - `has_function_privilege('anon', 'public.get_scraper_status()', 'execute')` is true.
    - The same check is false for `'public.scraper_status_at(timestamptz)'`.
    - `(select count(*) from public.get_scraper_status()) = 9`.
    - Under `set local role anon`, selecting from `service_health_events` throws `42501` (`throws_ok`).

- [ ] **Step 2: Run the SQL tests and confirm they fail.** Start the local DB, run `db reset --no-seed`, then the SQL test command. Expected: FAIL, because `scraper_status_at` does not exist.

- [ ] **Step 3: Write the migration.**
  - **Functions:** `scraper_status_at` (SQL or plpgsql, `STABLE`) and `get_scraper_status`.
  - **Revokes:** `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated` on `scraper_status_at`.
  - **Grants:** `GRANT EXECUTE ON FUNCTION public.get_scraper_status() TO anon, authenticated, service_role`.
  - **Comments:** add a `COMMENT ON FUNCTION` for each function.

- [ ] **Step 4: Run the SQL tests and confirm they pass.** Run `db reset --no-seed`, then the SQL test command. Expected: `All tests successful.`

- [ ] **Step 5: Commit**

```bash
git add services/core/supabase/migrations/20261103010000_scraper_status.sql services/core/supabase/tests/scraper_status_test.sql
git commit -m "feat(health): add scraper status rules and public RPC"
```

### Task 9: Hourly link-check schedule

**Files:**
- Create: `services/core/supabase/migrations/20261103020000_link_check_schedule.sql`
- Test: `services/core/supabase/tests/link_check_schedule_test.sql`

**Interfaces:**
- Consumes: the check-mode bodies that Tasks 2 to 5 accept: `{ "mode": "check", "samples": [{ "url": text, "expect_location": bool }] }`.
- Produces:
  - `public.link_check_samples(p_source text, p_now timestamptz DEFAULT now()) RETURNS TABLE(url text, expect_location boolean)`
  - `public.link_check_requests(p_now timestamptz DEFAULT now()) RETURNS TABLE(fn_name text, body jsonb)`
  - `public.run_link_checks() RETURNS bigint`, as `SECURITY DEFINER`.
  - The pg_cron job `check-link-imports` at `'40 * * * *'`.

**Sample rules:**
- Pick `event_source_links s JOIN events e ON e.id = s.event_id`.
- Filters: `s.source = p_source`, `s.ingest_kind = 'public_scrape'`, `s.url IS NOT NULL` and `e.status = 'published'`. For `facebook`, the URL must also match `'^https://(www\.|m\.)?facebook\.com/events/'`.
- Order: upcoming events first (`start_time >= p_now`, soonest first), then past events (most recent first). Limit 3.
- `expect_location = (e.format = 'in_person' AND nullif(btrim(e.location), '') IS NOT NULL)`.

**Requests:** one row per source, in this order: `('facebook','fb-scraper')`, `('luma','luma-scraper')`, `('meetup','meetup-scraper')`, `('eventbrite','eventbrite-scraper')`. The `body` is `{"mode":"check","samples":[…]}`, where `samples` is `[]` when there are none.

**`run_link_checks`:**
- Read `app_secrets.internal_fn_jwt`, and raise like `fan_out_account_syncs` if it is missing.
- For each request row, call `net.http_post` to `'https://enwcrupzidbcwimyttla.supabase.co/functions/v1/' || fn_name` with the same headers as `fan_out_account_syncs` and `timeout_milliseconds := 60000`.
- Return the number of requests made.

- [ ] **Step 1: Write the failing pgTAP tests.** Insert fixture `events` and `event_source_links` rows, filling every NOT NULL column the schema requires. Never call `run_link_checks()` in tests, because it would post to production.
  - Meetup: the upcoming event in 2 days comes before the one in 10 days, which comes before yesterday's past event. A fourth event is cut by the limit.
  - A `hidden` event is excluded. A `manual` link is excluded.
  - A Facebook link at `https://www.facebook.com/somepage` is excluded. `https://www.facebook.com/events/2552868275211222/` is included.
  - `expect_location` is true for in-person with a location, false for online, and false for in-person with a null location.
  - `link_check_requests()` returns 4 rows with the function names above. When there are no samples, `body` is `{"mode":"check","samples":[]}`.
  - `cron.job` has a row named `check-link-imports` with schedule `40 * * * *`.
  - `has_function_privilege('anon', …, 'execute')` is false for all three new functions.

- [ ] **Step 2: Run the SQL tests and confirm they fail.**

- [ ] **Step 3: Write the migration.**
  - **Functions:** the three functions above.
  - **Revokes:** `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated` on all three.
  - **Schedule:** `SELECT cron.schedule('check-link-imports', '40 * * * *', $cron$ SELECT public.run_link_checks(); $cron$);`
  - **Comments:** add a `COMMENT ON` for each function.

- [ ] **Step 4: Run the SQL tests and confirm they pass.** Run `db reset --no-seed`, then the SQL test command. Expected: both test files pass.

- [ ] **Step 5: Update the docs.**
  - In `ARCHITECTURE.md`, add a "Health checks and /status" subsection under Services:
    - the link checks (check-only mode, hourly);
    - the finding metadata (`line` and `page_read`);
    - the status function and public RPC;
    - the local SQL test commands.
  - In the spec, set Status to "approved; implementation per plan".

- [ ] **Step 6: Commit**

```bash
git add services/core/supabase/migrations/20261103020000_link_check_schedule.sql services/core/supabase/tests/link_check_schedule_test.sql ARCHITECTURE.md docs/superpowers/specs/2026-11-03-scraper-health-status-design.md
git commit -m "feat(health): schedule hourly link checks"
```

### Task 10: Open PR A, then verify in production after the user merges

- [ ] **Step 1: Run every suite once more.**
  - The core, Facebook, Luma, Meetup and Eventbrite Deno test commands all PASS.
  - `supabase test db supabase/tests/` gives `All tests successful.`
  - Stop the local DB.
- [ ] **Step 2: Rename the branch, push it and open the PR.**
  - `git branch -m feat/scraper-health-checks && git push -u origin feat/scraper-health-checks`
  - Open the PR with `gh pr create`. The body says that merging deploys production immediately, and lists the verification below.
  - Stop here until the user says to merge.
- [ ] **Step 3: Watch the deploy after the merge.** `gh run watch` on the `deploy-services.yml` run. Expected: every job green, and core's `db push` applies `20261103010000` and `20261103020000`.
- [ ] **Step 4: Trigger one link check by hand.** First record `scraped_at` for the sample rows: `select s.url, s.scraped_at from event_source_links s where s.url in (select url from link_check_samples('meetup'))`. Then run `select public.run_link_checks()` via `npx -y supabase@3.0.0 db query --remote --yes` from `services/core`. Expected: `4`.
- [ ] **Step 5: Check the recorded results.** After about 60 seconds, run `select bucket, status, fingerprint, message from service_health_events where source = 'link-check' order by id desc limit 4` with `--read-only`.
  - Expected: facebook, luma and meetup are `success`.
  - Eventbrite is `success` or `warning`.
  - Re-running the `scraped_at` query shows identical values, which proves check mode wrote nothing.
- [ ] **Step 6: Call the public RPC as anon.**
  - `curl -s -X POST "$PUBLIC_SUPABASE_URL/rest/v1/rpc/get_scraper_status" -H "apikey: $PUBLIC_SUPABASE_ANON_KEY" -H "Authorization: Bearer $PUBLIC_SUPABASE_ANON_KEY"`, with the values read from `apps/pwa/.env`. Expected: 9 rows. The Facebook, Luma and Meetup link lines are `working`. The Eventbrite link line is `working` or `no_test_event`. The Eventbrite finding line is `not_set_up`. The other finding lines stay `not_checked` until their next cron run.
  - The same call to `/rest/v1/rpc/run_link_checks` returns a permission error.
  - `GET /rest/v1/service_health_events?select=id&limit=1` returns an error or `[]`.
- [ ] **Step 7: Confirm the finding lines after the next cron runs.**
  - Wait for the next cron window: Luma at :00, Meetup at :15 and Facebook at :30, on 00/06/12/18 UTC.
  - Confirm rows with `metadata ? 'page_read'` exist for each line.
  - After Facebook's second run post-deploy (at most 12 hours), `watched_pages` is `broken`, and every other finding line is `working`.
  - Record the results in project memory.

---

## PR B: the `/status` page

Branch `feat/status-page` from `origin/main`, after PR A is deployed. The page reads production's `get_scraper_status`, so the Cloudflare preview only works once PR A is live.

### Task 11: Status formatting

**Files:**
- Create: `apps/pwa/src/lib/scraper-status.ts`
- Test: `apps/pwa/tests/scraper-status.test.ts`

**Interfaces:**
- Consumes: the `get_scraper_status` columns from Task 8.
- Produces:
  - `type LineState = 'working' | 'broken' | 'not_checked' | 'no_test_event' | 'not_set_up'`
  - `interface StatusRow { sort_order: number; source: string; source_label: string; line: string; line_label: string; state: LineState; since: string | null; last_worked_at: string | null; last_checked_at: string | null }`
  - `formatPht(iso: string): string`
  - `describeState(row: StatusRow): string`
  - `summarize(rows: StatusRow[]): string`
  - `loadScraperStatus(client: { rpc(fn: string): PromiseLike<{ data: unknown; error: unknown }> }): Promise<StatusRow[] | null>`

- [ ] **Step 1: Write the failing vitest tests.**

```ts
expect(formatPht('2026-11-03T07:05:00Z')).toBe('Nov 3, 3:05 PM PHT');      // plain spaces, no U+202F
expect(formatPht('2026-11-03T16:30:00Z')).toBe('Nov 4, 12:30 AM PHT');     // date rolls over in Manila
expect(describeState(row({ state: 'working' }))).toBe('Working');
expect(describeState(row({ state: 'broken', since: '2026-11-03T07:05:00Z' }))).toBe('Broken since Nov 3, 3:05 PM PHT');
expect(describeState(row({ state: 'not_checked', since: '2026-11-03T07:05:00Z' }))).toBe('Not checked recently (since Nov 3, 3:05 PM PHT)');
expect(describeState(row({ state: 'not_checked', since: null }))).toBe('Not checked recently');
expect(describeState(row({ state: 'no_test_event', since: '2026-11-03T07:05:00Z' }))).toBe('No test event available (since Nov 3, 3:05 PM PHT)');
expect(describeState(row({ state: 'not_set_up' }))).toBe('Not set up');
expect(summarize([row({ state: 'working' }), row({ state: 'not_set_up' })])).toBe('All working');
expect(summarize([row({ state: 'broken' }), row({ state: 'working' })])).toBe('1 problem');
expect(summarize([row({ state: 'broken' }), row({ state: 'not_checked' })])).toBe('2 problems');
expect(await loadScraperStatus(fakeRpc({ data: null, error: { message: 'x' } }))).toBeNull();
expect(await loadScraperStatus(fakeRpc({ data: [], error: null }))).toBeNull();          // empty never means "All working"
expect((await loadScraperStatus(fakeRpc({ data: [r2, r1], error: null })))!.map((r) => r.sort_order)).toEqual([1, 2]);
```

- [ ] **Step 2: Run the tests and confirm they fail.** Run `pnpm --filter pwa exec vitest run tests/scraper-status.test.ts`. Expected: FAIL, because the module is not found.
- [ ] **Step 3: Implement `scraper-status.ts`.**
  - `formatPht` uses `Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })`, replaces `/[  ]/g` with a space, and appends `' PHT'`.
  - `loadScraperStatus` calls `client.rpc('get_scraper_status')` and sorts by `sort_order`. It returns null on an error or an empty result.
- [ ] **Step 4: Run the tests and confirm they pass.**
- [ ] **Step 5: Commit**

```bash
git add apps/pwa/src/lib/scraper-status.ts apps/pwa/tests/scraper-status.test.ts
git commit -m "feat(pwa): add scraper status formatting"
```

### Task 12: The `/status` page

**Files:**
- Create: `apps/pwa/src/pages/status.astro`

**Interfaces:**
- Consumes: Task 11's exports, plus `supabase` from `src/lib/supabase.ts`. Cast it the way `api/reliability-metrics.ts` does: `(supabase as any)`.

- [ ] **Step 1: Build the page.**
  - **Setup:** `export const prerender = false`. Use `Layout` with title `Cebby status`, and `SEO` with `noindex` and a one-line description.
  - **Headers:** set `Astro.response.headers.set('Cache-Control', 'public, max-age=60, s-maxage=60')`.
  - **When `loadScraperStatus` returns null:** set `Astro.response.status = 503` and render only the heading "Status unavailable" and the line "Cebby couldn't load its checks."
  - **Otherwise, render:**
    - an `<h1>` with `summarize(rows)`;
    - one list item per row: `{source_label} · {line_label}: {describeState(row)}`, followed by ` · Last worked: {formatPht(last_worked_at) | 'never'}`, except for `not_set_up` rows;
    - a footer line: "Checks run hourly for links and every 6 hours for finding new events. Times are Philippine time (PHT)."
  - **Constraints:** no colour-only signals, all text server-rendered, and no client script.
- [ ] **Step 2: Build the app.** Run `pnpm --filter pwa build`. Expected: the build succeeds.
- [ ] **Step 3: Check the page without JavaScript.**
  - Run `pnpm --filter pwa dev` and `curl -s localhost:<port>/status | sed 's/<[^>]*>//g' | grep -E 'All working|problem|Facebook'`. Expected: the summary and 9 row lines appear in the raw HTML.
  - Also confirm `<meta name="robots" content="noindex">` is present.
- [ ] **Step 4: Run the full PWA test suite.** Run `pnpm --filter pwa test`. Expected: all tests PASS.
- [ ] **Step 5: Commit, push and open PR B.**

```bash
git add apps/pwa/src/pages/status.astro
git commit -m "feat(pwa): add public /status page"
git push -u origin feat/status-page && gh pr create
```

  - Ask the user to check `/status` on the Cloudflare preview before merging.
  - After the merge, run `curl -s https://www.getcebby.com/status` and confirm the lines.
  - Then give the user the grok-bot routine text from spec §6, updated with the line: "If the page doesn't load or says Status unavailable, tell me."

---

## PR C: narrow the old watchdog (after PR B is verified)

### Task 13: Typesense-only watchdog

**Files:**
- Create: `services/core/supabase/migrations/20261104010000_watchdog_typesense_only.sql`. Use a later timestamp if production's latest migration has moved past it.
- Modify: `ARCHITECTURE.md` (the watchdog now covers search sync only; the scrapers are covered by `/status`).

- [ ] **Step 1: Write the migration.**
  - `DROP VIEW` and `CREATE VIEW public.service_health_bucket_summary`, with the definition copied from `20260501030000_service_health_buckets.sql`.
  - Its `buckets` VALUES list keeps only `('typesense'::text, 24, 20, 5)`.
  - Re-apply the same `GRANT` and `COMMENT`.
- [ ] **Step 2: Verify locally.** Run `db reset --no-seed`, then `npx -y supabase@3.0.0 db query "select bucket from public.service_health_bucket_summary"` against the local DB. Expected: one row, `typesense`.
- [ ] **Step 3: Commit, push and open PR C.**

```bash
git commit -m "chore(health): narrow watchdog to search sync"
```

  - Stop until the user says to merge.
  - After the merge and deploy, run `gh workflow run ingest-watchdog.yml -f environment=production` and watch it. Expected: green, with the log showing `service health watchdog healthy`.
