# /status diagnostics: honest states, missed runs, and inspectable bars

Date: 2026-11-04
Status: approved by Dorell 2026-11-04
Builds on: `2026-11-03-scraper-health-status-design.md` (the "first spec"). Read its §2 (states), §5 (page and safety rules) and §6 (grok-bot routine) first.

## Why

The live `/status` page (PR #102) answers "Can Cebby still discover and import events from its supported sources?" but has four blind spots, all seen in production on 2026-11-03/04:

1. **A run that never reports looks like no run, and a partial run looks complete.** Supabase's gateway returned 502 for Eventbrite's 18:40Z and Facebook's 21:40Z link checks: no row was written, and those windows' bars say "5 of 5 passed". The 00:30Z Facebook cron got 26×502 plus 3 timeouts; watched pages reported 16 accounts instead of 22, and nothing showed it. A finding window passes when half of the accounts *that reported* were read, so missing accounts can't lower it.
2. **"Working" hides shortfalls.** Partner pages read 12 of 15 every run (3 rejected tokens), Meetup 22 of 24 (2 deleted groups).
3. **No diagnosis.** A problem row has a state word and times. "Last checked" is in the data but not on the page. Partner-page, Meetup and Luma read failures store no reason at all (only `page_read: false`); the cause is only in function logs.
4. **Bars are hover-only** (`title`), so they can't be inspected on a phone, and they don't show failed counts or missing reports.

## Decisions

**Dorell decided (2026-11-04):**
- **States are renamed** to Healthy, Degraded, Broken, Unknown and Not configured. He gets new grok-bot routine text (§8) and updates the routine in grok when this deploys. "Updated:" and "Noticed:" keep their exact words.
- **The public page says what is affected, never why.** No error text, failure categories (such as "access token rejected"), account names or URLs on `/status`: a visitor can't act on them, and they expose how Cebby connects to its partners. The causes are recorded and shown on a new page in the admin app (`apps/admin`, behind its basic auth).
- **grok-bot may read internal data.** Today the admin app is local-only (Node adapter on 127.0.0.1), so grok can't reach it; giving grok the causes needs a hosted, authenticated endpoint, which is follow-up work (see Limitations).
- **Persistent shortfalls are Degraded until fixed.** On deploy, Facebook partner pages and Meetup finding turn Degraded and stay so until the 3 tokens are refreshed and the 2 groups deactivated or repointed.

**Dorell decided after reviewing PR #105's page (2026-11-04, evening):**
- **No counts in public.** `/status` never shows how many accounts, pages, groups or checks a line has: not in sentences, popovers, the legend or hover text, because they describe who Cebby watches. Hiding them in the HTML isn't enough: the anon RPCs don't return them either. Counts stay in the private functions and in `service_health_events` for the admin app.
- **Problem sentences say what is affected in words:** "Some partner pages couldn't be checked in the latest run.", "Most …", "None of the watched pages could be checked in the last 2 runs." A link line may still say "The last 2 checks couldn't import a test event.", which counts checks, not organisations.
- **A bar's popover shows its time range and result word only.**
- **A clearer hierarchy** (§6): the bars run full width under the title and sentence, and a row's times sit on one muted line. A healthy row shows "Last checked" alone unless its last success differs, and the public page drops "First detected".

**Kept from the first spec:** real attempts only; link and finding tracked separately; two results in a row before anything alerts (false alarms that fix themselves are the anti-goal); nothing private on the public page; `anon` never reads `service_health_events`; internal functions in `private` behind thin `SECURITY DEFINER` wrappers; no client script on `/status`.

**My calls (open to veto)** are marked *(call)* below.

## Goals, non-goals, anti-goals

**Goals:** each state is backed by recorded evidence; a missed or partial run is visible; each problem row explains what is affected in one sentence; every bar can be inspected by tap or keyboard; the causes are one admin page away; the grok-bot routine keeps working with one text update.

**Non-goals:** event counts, deduplication or publication analytics (the page stays health-only); fixing the 5 broken accounts or the watched-pages coverage; capturing pg_net's 502/timeout codes (pg_net keeps about 6 hours; "didn't run" covers the effect); Typesense health; a JSON endpoint; hosting the admin app.

**Anti-goals:** a green that lies; an alert for a one-off blip (a single partial run from a 502 burst must not alert); any cause, error text, account name, URL or count of accounts, pages, groups or checks on `/status` or from its anon RPCs; a client script on `/status` (grok-bot reads the server-rendered text).

## 1. Evidence: record that a scheduled run started

Today only results are recorded, so "no result" can mean the cron never fired, or every call died at the gateway. *(call)* Each scheduled run now writes one **run-started row** per line before it sends any request:

- `bucket` = source, `source` = `'scheduled-run'`, `status` = `'success'`, `fingerprint` = `'run_started'`.
- `metadata` = `{"line": "link"}` for a link check, or `{"line": "<line>", "expected": <n>}` for a finding run, where `expected` is how many accounts that line should report (§2).
- **Link checks:** `private.run_link_checks()` inserts one row per source (4 per hour) in the same transaction as its pg_net posts.
- **Finding runs:** new `private.record_finding_runs(p_type text)`, called from each finding cron's command just before `public.fan_out_account_syncs(...)` (`cron.schedule` with the same job name replaces the command). API roles can't reach `private`, so nobody can fake run rows. Facebook writes two rows (partner_pages and watched_pages).

A distinct `source` keeps these rows out of every existing reader: the status and history SQL count `source = 'link-check'` and rows with `metadata.page_read`; the old watchdog view would count them only as successes. About 100 rows a day.

Windows from before this deploy have no run rows. They are read with today's rules (expected = accounts that reported; no missed detection) and never shown as missed.

## 2. Expected accounts per finding line

`public.finding_targets()` returns `(source, line, account_id, name)` for every account the cron should report on, mirroring each handler's routing:

| Line | Active accounts (`is_active`) where |
|---|---|
| facebook / partner_pages | an `account_secrets` row has `page_access_token` or `access_token` |
| facebook / watched_pages | no such token, `ingest_kind = 'public_scrape'`, non-empty `discovery_path` |
| meetup / finding | non-empty `discovery_path` |
| luma / finding | non-empty `discovery_path` |

Production on 2026-11-04 gives 15 / 22 / 24 / 15, matching every complete run. The function is `SECURITY INVOKER`: `anon` gets "permission denied for table account_secrets" (anon has no SELECT on it), while `service_role` (admin) and the status function (running as its `SECURITY DEFINER` owner) see all rows. One definition serves both. A comment in each cron handler points at it, so a routing change updates both.

## 3. Results

**Link check** (one per scheduled hour): `pass`, `fail` or `no_sample` as today. A run-started row with no link-check result within 10 minutes is **missed** (the check posts with a 60 s timeout, so results land within about a minute).

**Finding window** (6-hour UTC window, judged once it is an hour old, as today). Per line and window:
- `expected` E: the window's run-started `expected` (max, if the cron fired more than once), or null before this deploy.
- `reported` R: distinct accounts with a row for that line (an account's latest row in the window counts).
- `read` P: of those, accounts whose page was read. `failed` = R − P. `missing` = max(E − R, 0).
- Result:
  - **missed**: a run-started row and R = 0.
  - **fail**: P × 2 < R. The scraper failed on most of what it tried (today's rule).
  - **partial**: P < (E, or R when E is null). Some pages weren't read, or some accounts didn't report.
  - **pass**: every expected account reported and was read.

Missing reports make a window partial, not failed: the scraper still worked on what it tried, so it's a coverage problem. A window that reports nothing is missing evidence, not a failure. The existing step-by-step `visible_at` logic (a window's result as rows landed) is kept, with the new result rule.

## 4. Line states

Evidence results are pass, partial, fail and no_sample. **Missed results never count as pass or fail:** they show in the bars and the row's sentence, and long silence is caught by staleness (unchanged: Unknown after 3 hours without a link result or 13 hours without a finding result).

| SQL `state` | Page word | Pill | When |
|---|---|---|---|
| `working` | **Healthy** | quiet emerald | The latest result passed, or a single non-pass right after a pass (one blip). |
| `degraded` *(new)* | **Degraded** | amber | The last two results are both partial or fail, and not both fail. |
| `broken` | **Broken** | rose | The last two results both failed. |
| `not_checked` | **Unknown** | amber | No result within 3 h (link) or 13 h (finding), or no results in 7 days. |
| `unconfirmed` | **Unknown** | amber | A lone first fail or partial with nothing before it to judge against (today's set-aside rule, widened to partial). |
| `no_test_event` | **Unknown** | amber | The latest link check had no usable test event. |
| `not_set_up` | **Not configured** | quiet stone | Eventbrite finding. |

*(call)* The SQL state codes stay as they are (plus `degraded`): they carry the reason, and the page maps them to the five words, so the specific cause becomes the row's sentence instead of being lost. Link lines can't be partial (one attempt per hour), so they are never Degraded.

**Times:**
- `since` (shown in no public text since the 2026-11-04 review; still returned): Broken and Degraded use the first result of the trailing run of partial or fail results, so a problem that worsens from Degraded to Broken keeps its start. No test event and stale keep today's rules.
- `noticed_at` ("Noticed:", what grok-bot alerts on):
  - Broken: when its second consecutive fail became visible.
  - Degraded: when its second consecutive non-pass became visible.
  - So Degraded → Broken alerts again (it got worse), and Broken → Degraded doesn't.
  - Unknown (stale) and No test event: unchanged. Unconfirmed: none.
- `last_checked_at`: the latest result. `last_worked_at`: the latest pass. With partial now distinct, a finding line's last pass is the last time every page in it was checked, so the page labels it "Last fully working" (a link line's stays "Last successful").
- New `last_run_at`: the latest run-started row, so an Unknown line can say whether checks are starting but not finishing, or not starting at all.
- New `missed_runs`: scheduled runs after the latest result that never reported.
- New `latest jsonb`, the latest raw result: `result` and `at`, plus for finding `window_start`, `expected`, `reported` and `read`.
- New `unread`: how much of a finding line wasn't read, as a word: `none`, `some`, `most` (fewer than half read) or `all`, against the expected accounts (or, with no run row, those that reported). Broken takes the less severe word of its last two results, so a sentence about "the last 2 runs" is true of both. Null for link lines.

`missed_runs` and `latest` carry counts, so they stay in `private.scraper_status_at`. **`public.get_scraper_status()` returns** the states and times plus `latest_result` (the latest result word), `unread`, and `missed_run` (whether any run since the latest result never reported). **`public.get_scraper_history()` returns** `source`, `line`, `window_start` and `result` per window; the expected, ran, passed, failed and missed counts stay in `private.scraper_history_at`. pgTAP pins both column lists.

Both `RETURNS TABLE` shapes change, so the migration drops and recreates `private.scraper_status_at`, `public.get_scraper_status`, `private.scraper_history_at` and `public.get_scraper_history`, then re-grants the public wrappers to `anon, authenticated, service_role`. It never revokes. All of this runs in one migration transaction.

## 5. Failure causes (recorded by the functions, shown only in admin)

Each cron handler records why a page wasn't read. `findingMetadata` adds `read_error` (a code) and `read_error_detail` (the raw message, cut to 300 characters) next to `page_read: false`. Link checks add `failure` (a code) to their metadata. All of it stays in `service_health_events`, which `anon` can't read; the public functions never return it.

| Code | Raised by |
|---|---|
| `token_rejected` | Graph error 190 / OAuthException |
| `permission_denied` | Graph 10, 200–299 |
| `rate_limited` | Graph 4, 17, 32, 613; HTTP 429 |
| `not_found` | Meetup group gone; HTTP 404 |
| `no_event_list` | FB watched "No event data found" |
| `unexpected_page` | Meetup or Luma data blob missing or changed |
| `fetch_failed` | network or other HTTP error |
| `crashed` | handler exception |
| `missing_title` / `missing_start_time` / `missing_location` | link-check field check |
| `read_error` | link-check probe exception |
| `other` | anything unrecognised |

The exact mapping per branch is the builder's. Classifiers are pure functions with Deno tests.

## 6. The public page (`apps/pwa/src/pages/status.astro`)

Grouping by source, the pill palette and still dots stay. Revised after Dorell's review of PR #105 (see Decisions).

```
Last 7 days, 6 hours per bar:  ▮ Passed  ▮ Partly failed  ▮ Failed  ▮ Didn't run  ▮ No data

Facebook
  Importing from a link                                  ● Healthy
  ▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▯
  Last checked: Nov 4, 10:40 PM PHT

  Partner pages                                       [● Degraded]
  Some partner pages couldn't be checked in the latest run.
  ▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▯
  Noticed: Nov 4, 9:00 AM PHT · Last fully working: not in the last 7 days · Last checked: Nov 4, 8:31 PM PHT
```

- **Headline:** "All healthy", or "1 problem" / "N problems". "Status unavailable" (503) is unchanged.
- **Row order:** name and status; a problem's sentence (ink, medium weight: the one emphasised line); the bars at full row width, so every row's windows share the same columns; then one muted line of times. A problem row has a faint wash of its tone; the colour lives in the pill and the bars, and the text stays ink and stone.
- **Times line:** "Label: time" items joined by " · ". Each item wraps only as a whole, and a line never starts or ends with a dot.
  - Healthy: "Last checked: …", plus its last success only when that shows a different time.
  - Problem: "Noticed: …", its last success, "Last checked: …". No "First detected": it falls within the hour before "Noticed", and two start times confuse.
  - The last success is "Last fully working" on a finding line, which can partly work, and "Last successful" on a link line. A missing time reads "not in the last 7 days", since the query looks back only 7 days and "never" would claim more than the data shows.
- **Problem rows add one plain sentence about what is affected, never why or how many.** For example:
  - Degraded: "Some partner pages couldn't be checked in the latest run." ("Most …" or "None of the … could be …" by `unread`.)
  - Broken (finding): "None of the watched pages could be checked in the last 2 runs." or "Most watched pages couldn't be checked in the last 2 runs."
  - Broken (link): "The last 2 checks couldn't import a test event."
  - Unknown (stale): "No result since Nov 4, 9:40 AM PHT. Checks normally run every hour." plus "Checks have started since then but haven't finished." or "No check has started since then."
  - Unknown (lone failure): "The latest check failed. Waiting for the next one to confirm." (finding: "Some partner pages couldn't be checked in the latest run. Waiting for the next one to confirm.")
  - Unknown (no test event): "No recent event to test with."
- **A Healthy row after a blip or a missed run** shows a quiet note above its times: "The latest check failed; the one before passed.", "Some partner pages couldn't be checked in the latest run." or "A recent check didn't finish." Nothing is hidden, and nothing alerts.
- **No technical-details section.** Debugging detail and every count are on the admin page.
- **Bars:** each bar is a `<button popovertarget>` with a native `popover` panel. It works by tap, click and keyboard, with no script; the open bar is outlined (`:has(+ :popover-open)`).
  - The panel shows the window's time range (PHT) and its result word only: "Passed", "Partly failed", "Failed", "Didn't run", "No test event", "No data" or "In progress".
  - It is anchored to its bar where CSS anchor positioning works, otherwise the browser's centred popover.
  - The panel's words never use the line words (Healthy, Degraded, Broken, Unknown, Not configured) or "Noticed"/"Updated", so a text reader can't mistake a window for a check. A test enforces this.
- **Legend** (above the first source): only the colours the page shows, at most five. No test event, no result and in progress share one neutral colour and the entry "No data"; the popover names which.
- **The PWA tolerates both RPC shapes,** in case Cloudflare deploys before `db push`. Missing new columns fall back to words without the coarse level. The old history's counts are never read. `mixed` reads as `partial`, and an unknown state renders as itself.

## 7. The admin page (`apps/admin/src/pages/health.astro`)

Behind the admin app's basic auth, using its existing service-role client. Read-only. Per line:

- the latest finding window's unread accounts: account name and id (linking to `/orgs/[id]` where one exists), cause code and raw detail (`read_error_detail`, or the row's `message`);
- **didn't report back:** `finding_targets()` minus the accounts that reported in that window, by name;
- the last 24 hours of failed or no-test-event link checks, with each attempt's URL, outcome and reason;
- missed link checks: run-started times without a result.

Grouping logic lives in a pure `src/lib` module with vitest tests.

## 8. grok-bot routine (spec §6 replacement, Dorell pastes it into grok on deploy)

> Every 2 hours, read https://www.getcebby.com/status. For any check whose "Noticed:" time is within 2 hours before the page's "Updated:" time, message me its source, its name, its status, the sentence under it, and its times. If the page doesn't load or says "Status unavailable", tell me. Once a day at 9 AM PHT, list every check (with its source) whose status isn't "Healthy" or "Not configured".

Until it is pasted, the old daily filter ("isn't Working or Not set up") lists every check; the 2-hour alert rule is unaffected.

On deploy, partner pages and Meetup (and, while some of its pages fail, watched pages) become Degraded from rows already recorded, so their "Noticed:" is when their second short window became visible. If that is more than 2 hours before the deploy, they don't alert; they appear in the next daily list instead.

## 9. Tests

- **pgTAP** (`services/core/supabase/tests/`, at fixed `p_now`):
  - **Transitions:** pass → one partial (still Healthy) → two partials (Degraded, `since` at the first, `noticed_at` at the second's visible time) → two fails (Broken, `since` unchanged, `noticed_at` moves) → one partial (Degraded, `noticed_at` doesn't move) → pass (Healthy; since and noticed cleared). A lone first partial is unconfirmed. Today's link-line cases still hold.
  - **Missed heartbeats:**
    - A link run row with no result is missed after 10 minutes, but not before.
    - One missed check leaves the line Healthy with `missed_runs = 1`.
    - Silence past 3 h makes it Unknown, with `last_run_at` after `last_checked_at`.
    - With no run rows at all, `last_run_at` stays old.
    - A finding window with a run row and no reports is missed and doesn't count as a fail.
  - **Partial failures:** E = 22, R = 16, P = 0 gives fail. E = 22, R = 16, P = 16 gives partial. E = 15, P = 12 gives partial. A window with no run row uses R as expected.
  - **Recovery:** Degraded → pass gives Healthy; Broken → pass gives Healthy; Unknown → result gives that result's state.
  - **Safety:** the public wrappers return no cause, message or count fields (their column lists are pinned), and anon gets the coarse words. `anon` can execute them, still gets 42501 on `service_health_events`, and gets an error from `finding_targets()`. `record_finding_runs` writes the expected counts.
  - **History:** the expected and missed columns, and `partial`/`missed` results.
- **Deno** (`services/core/tests/health_checks_test.ts` and per-source tests): classifiers per branch; `findingMetadata` adds `read_error`/`read_error_detail` only when the page wasn't read, and truncates; link `failure` codes.
- **Vitest** (`apps/pwa/tests/scraper-status.test.ts`):
  - each state's word and tone, and the headline;
  - sentences per state and `unread` word, and that no sentence or note contains a count;
  - the times line ("Last successful" only when it differs on a healthy row) and "not in the last 7 days";
  - popover text (range and result only), and that it never contains a line word or "Noticed"/"Updated";
  - the legend lists only the colours shown;
  - the old RPC shape still renders.
- **Vitest** (`apps/admin/tests/`): the admin grouping module.

## 10. Verification (read-only against production)

1. Copy the last 7 days of production `service_health_events` for the 4 buckets, plus the accounts the targets read, into the local database with read-only queries. Run the new functions there at several `p_now` values. Check that:
   - partner pages and Meetup come out Degraded;
   - watched pages comes out Broken;
   - the Eventbrite and Facebook 18:00Z link windows show 5 results and no missed checks (those runs predate run rows).
   - Re-run on 2026-11-04 at 15:05Z through the public wrappers as `anon`, after the no-counts change: partner pages, watched pages (now 18 of 22 read since #103) and Meetup come out Degraded with `unread` "some", Luma and the four link lines Healthy, and neither wrapper returns a count.
2. After deploy:
   - the first hourly run writes 4 run-started rows;
   - the next finding crons write `expected` rows matching 15 / 22 / 24 / 15;
   - the anon RPC returns the new columns;
   - `www.getcebby.com/status` shows the new words, and the bars open at phone width.

## 11. Delivery

*(call, changed from the draft)* One PR from `feat/status-diagnostics`: migration `20261104020000_status_diagnostics.sql` (re-checked against `main` before merge, since PR C adds `20261104010000`), the function changes, the PWA page, the admin page and the docs (this spec, first spec §6 note, `ARCHITECTURE.md`). The admin page ships in the same PR because it is the only place the recorded causes can be seen; the admin app isn't deployed, so it adds no deploy risk. Merging deploys functions and `db push` to production; Dorell reviews before merge and pastes the routine text when it deploys.

## Limitations

- grok-bot can't read the causes until the admin data is served somewhere it can reach (a hosted admin app, or a token-protected endpoint). Follow-up.
- Before this deploy there are no run-started rows, so the first 7 days of history can't show missed runs or expected counts for older windows.
- `finding_targets()` copies the cron handlers' routing. If a handler's routing changes without it, expected counts drift. The handlers carry a comment pointing at it.
- A bar is about 10 px wide on a 390 px phone (32 px tall), short of the 44 px tap target, so tapping a specific bar takes care; each bar is also a keyboard stop.
