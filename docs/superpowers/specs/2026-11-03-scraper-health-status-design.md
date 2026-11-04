# Scraper health status and grok-bot alerts

Date: 2026-11-03
Status: approved; implementation per plan (`docs/superpowers/plans/2026-11-03-scraper-health-status.md`)
Roadmap: infra item #3 (monitoring with notifications). It also lays the data groundwork for #2 (public status page).

## Why

In late October 2026, Facebook changed its event pages, and every public Facebook import broke. Nothing told the user. They found out by accident: someone DM'd them an event on Messenger, they asked grok-bot to import it, and grok-bot said it couldn't.

The monitoring that existed (`service_health_events`, the `service_health_bucket_summary` view, and the GitHub `ingest-watchdog.yml` job) stayed green through the whole outage. It only counts what the scrapers report about themselves:
- A cron run that finds zero events records "success".
- Imports from a link record nothing at all.
- Facebook's partner pages (healthy) and watched pages (broken) share one bucket, so the healthy path hid the broken one.

The goal: when a source stops working, grok-bot tells the user, before anyone's DM exposes it.

## What the user experiences

grok-bot already runs scheduled routines that read web pages. It cannot be messaged by Cebby. So:

1. Cebby keeps a public status page up to date at a fixed address.
2. A grok-bot routine reads that page on a schedule.
3. When a line on the page stops saying it's working, grok-bot tells the user which line, and since when.

Success looks like this: the next time Facebook (or Meetup, Luma or Eventbrite) changes its pages, grok-bot tells the user within a few hours, and the user never learns about it from a DM.

## Goals, non-goals, anti-goals

**Goals**
- Each source is judged by a real attempt: Cebby actually reads a real page from that source and checks the result. The scrapers' own "success" reports don't count.
- Importing from a link and finding new events are tracked as separate lines (the user's decision).
- Facebook's finding is split into partner pages and watched pages.
- A plain public status page that grok-bot can read, from the same data the future public status page (#2) will use.

**Non-goals** (separate work)
- Fixing Facebook's watched-page login wall. That line will show broken from day one, and the user wants it to stay red until it's fixed.
- Building Eventbrite's finding of new events.
- Cebby sending notifications itself (push, email, Messenger). grok-bot is the channel.
- Designing the public status page (#2). This ships a plain version at the same address, and #2 restyles it later.
- Search (Typesense) health, staging (#1), admin route security (#4) and the grok-bot admin skill (#5).

**Anti-goals** (failure even if it technically works)
- **False alarms that fix themselves on the next run.** In the user's words, this is what would make them start ignoring grok-bot.
- **A green that lies.** No line may show green unless Cebby really read a real page and got the expected data back.
- **Leaking anything on the public page:** event data, account names, error text or internal details.
- **Checks that write to the database.** An hourly check must not create or update events, upload images, geocode, or set off search re-syncs.

## Current state (verified against production, 2026-11-03)

| Source | Importing from a link | Finding new events by itself |
|---|---|---|
| Facebook | `fb-scraper` works; it was fixed today in PR #97. It records no health events. | **Partner pages:** 15 accounts with tokens, using the Graph API, every 6h. Working. **Watched pages:** 104 `public_scrape` accounts. Broken since about mid-September, because Facebook's page event listings sit behind a login wall. These record `watch_no_events` warnings. |
| Meetup | `meetup-scraper`. Records no health events. | 24 groups every 6h. Working; finds a few events a day. |
| Luma | `luma-scraper`. Records no health events. | 15 calendars and users every 6h. Zero events since Oct 25, but every calendar really has no upcoming events: its live page says `has_upcoming_events: false`. Quiet, not broken. |
| Eventbrite | `eventbrite-scraper`. Records no health events. | Not built. `retrieve-and-sync-to-db-eventbrite-events` is a stub, and its cron is commented out. |

Other facts the builder needs:
- **Crons:** pg_cron fans out per account through `public.fan_out_account_syncs(type, fn_url)` using pg_net. Luma runs at :00, Meetup at :15 and Facebook at :30, each every 6 hours. The bearer token is `app_secrets.internal_fn_jwt`.
- **Failures that look like success:** `services/luma/.../_shared/lumautils.ts` returns `[]` on any fetch or parse failure, so a broken Luma looks exactly like a quiet Luma. `meetuputils.ts` has the same pattern.
- **Health table access:** `service_health_events` has RLS on, and `anon` and `authenticated` have no access.
- **The PWA:** `apps/pwa` is Astro 5, server-rendered on Cloudflare, and served at www.getcebby.com. It reads Supabase with the anon key.

## The design

### 1. Status lines

| Line | Check |
|---|---|
| Facebook: importing from a link | link check |
| Facebook: partner pages | finding check |
| Facebook: watched pages | finding check |
| Meetup: importing from a link | link check |
| Meetup: finding new events | finding check |
| Luma: importing from a link | link check |
| Luma: finding new events | finding check |
| Eventbrite: importing from a link | link check |
| Eventbrite: finding new events | always "Not set up" until it's built |

### 2. Line states and rules

Each line is in exactly one of these states:

- **Working**: the latest check passed. Also stays Working when only the single latest check failed and the one before it passed (one blip never alerts).
- **Broken since <time>**: the last two checks in a row both failed. `<time>` is when the first of the current failed checks happened.
- **Not checked recently**: no check result arrived in time. That means more than 3 hours for link checks, or more than 13 hours for finding checks. This catches the checks themselves dying.
- **No test event available**: a link check had no usable real event to try (see 3).
- **Not set up**: the line exists but isn't built (Eventbrite finding).

Only **Working** and **Not set up** are quiet. Every other state is something grok-bot should report.

The rules live in one place in the database, as a SQL view or function. That way this page and the future #2 page read the same answers.

### 3. Link checks (importing from a link)

- **When:** every hour, for each of the four sources, triggered by a new pg_cron job using the existing pg_net pattern.
- **What:** Cebby picks a recent real event from that source out of `event_source_links`, using its stored `url`, and asks that source's existing scraper function to read it in a new **check-only mode**. Check-only mode fetches and parses exactly as a real import does, then stops. It doesn't ingest, store images, geocode or touch search.
- **"Comes out right" means:** the parsed result has a non-empty title and a valid start time, plus a location if the stored copy of the event has one. *My call:* no exact comparison against stored values, because organizers legitimately edit titles and reschedule, and that would cause false alarms.
- **Picking the event:** use the most recent public events for that source; for Facebook, only `public_scrape` URLs like `facebook.com/events/<id>`.
  - If the chosen event is gone (deleted or not found), skip it and try the next one. Gone is not a failure.
  - If two different events both fail to parse, the check fails.
  - If no usable event exists, the line shows **No test event available**. Eventbrite has only two links today, so this can happen.
- **Recording:** each check writes one row to `service_health_events` with its own source name (for example `link-check`), so it never mixes with cron rows.

### 4. Finding checks (finding new events)

- **When:** on every existing 6-hourly cron run. No new schedule.
- **What changes:** each account's run must record whether Cebby could actually **read the listing page**, separately from how many events it found. Zero events with a page that was read is Working. A page that couldn't be fetched or understood is a failure.
  - **Luma calendar:** read OK when `__NEXT_DATA__` parses and `initialData.data` is present. `has_upcoming_events: false` is a valid "read OK, empty" result.
  - **Luma user:** read OK when the api2 call succeeds.
  - **Meetup group:** read OK when the page's data blob parses. The builder confirms what an empty group looks like.
  - **Facebook partner:** read OK when the Graph API call succeeds; an expired or invalid token is a failure.
  - **Facebook watched:** read OK when the listing data is found. "No event data found" (the current login-wall result) is a failure.
- **Run verdict** *(my call)*: a source's run counts as working if **at least half** of its active accounts' pages were read OK. This keeps one stale account (say, a deleted calendar) from turning the whole source red, while a site-wide block still does.
- Facebook partner and watched accounts are judged as separate lines.

### 5. The status page

- **Address:** `https://www.getcebby.com/status`, a server-rendered page in `apps/pwa`. *My call:* one address for good, so the grok-bot routine never changes, and #2 restyles this same page later.
- **Content:**
  - A one-line summary at the top: "All working", or "N problems".
  - Then one row per line: the source, the line name, the state, and when it last worked.
  - Times are shown in Philippine time and labelled (PHT).
  - Plain words only, no colours or icons as the only signal, and readable without JavaScript, because that's how grok-bot reads it.
- **Public safety:** the page gets its data through one narrow, read-only database function, callable by `anon`, that returns only those per-line fields. `anon` must still be unable to read `service_health_events` itself. No event names, account names, URLs or error text appear.
- **Crawling and caching:** not indexed by search engines (`noindex`), and cached for at most a few minutes so grok-bot sees fresh state.
- **Styling:** uses the site's existing layout and tokens (cards and status pills from `.impeccable.md`). *Changed in PR B at the user's request:* checks are grouped by source, and problems carry a rose or amber pill. Each check also shows a strip of history bars (the last 7 days in 6-hour windows), from a second read-only function, `public.get_scraper_history()`, with the same safety rules as the status function.

### 6. The grok-bot routine (the user sets this up)

This is the suggested routine text. It is stateless on purpose, so it works whether or not grok-bot remembers earlier runs:

> Every 2 hours, read https://www.getcebby.com/status. For any check whose "Noticed:" time is within 2 hours before the page's "Updated:" time, message me its source, its name, its status and its times. If the page doesn't load or says "Status unavailable", tell me. Once a day at 9 AM PHT, list every check (with its source) that isn't "Working" or "Not set up".

Only problem checks carry "Noticed:": when the problem first showed on the page (for Broken, its second failure; for a finding line, when that 6-hour window was judged, or when later rows turned it failing). Keying on it, rather than on "Broken since" (the first failure), is what lets a 2-hour rule catch each new problem once. "Updated:" is the page's own time, so the routine never compares Philippine times against its own clock. *Changed in PR B after review:* the first version keyed on the state words' time. The page later grouped checks under a heading per source, so the routine names the source itself.

The "within the last 2 hours" rule means a long-running known problem, such as Facebook watched pages, alerts once when it starts and then only shows up in the daily summary. It doesn't nag every run.

### 7. The existing GitHub watchdog

*My call:* once the status page is live and verified, narrow `service_health_bucket_summary` and `ingest-watchdog.yml` to Typesense only, and let the status page own the scrapers. Otherwise the new hourly link-check rows count against the old error budgets, and the old job starts failing with duplicate, noisier alerts. The user can veto this and keep both.

## Constraints

- **Merges deploy straight to production.** Merging anything under `services/**` to main deploys every service's functions and runs `db push`. There is no staging.
- **Migration timestamps:** new migrations must sort after production's latest, currently `20261026020000`. `db push` rejects older ones.
- **PWA review:** PWA changes deploy to a Cloudflare preview, and the user checks them by hand before merging.
- **The user reviews every PR before it merges.** Commits carry no AI attribution. Use a short imperative subject, and keep each body paragraph on one line.
- **Supabase CLI:** CI is pinned to 3.0.0.
- **Facebook load:** at most one link check per hour against Facebook, using the scraper's existing browser-like headers.

## What the user decided vs. my calls

**Decided by the user:**
- grok-bot is the alert channel.
- A source works only if a real attempt succeeds.
- No alerts for failures that fix themselves.
- Link imports and finding are separate lines.
- Facebook partner and watched are split, and watched shows red until it's fixed.
- The page is public, health only, with no data.

**My calls (open to veto):**
- The hourly link checks, and the 2-in-a-row rule as the alert threshold.
- The check-only mode, with no database writes.
- "Comes out right" means fields are present, not values matching what's stored.
- Skipping events that are gone.
- The half-of-accounts rule for finding runs.
- The 3h and 13h staleness limits.
- The `/status` address in the PWA, Philippine time, and the stateless grok-bot routine text.
- Narrowing the old watchdog to Typesense.

## Left to the builder

- **Data shape:** naming of sources, fingerprints and metadata in `service_health_events`, and how to group the per-account rows of one cron run (a run id passed through the fan-out, or a time window).
- **Check-only plumbing:** how check-only mode is requested (a body flag, for example), and how it is authorised, at least as strictly as today's scraper calls.
- **Status logic:** whether the status rules are a view or a function, and how to test them.
- **Pull requests:** how to split the work. Likely (a) services and database, (b) the PWA page, and (c) the watchdog narrowing.
- Whether to also serve a JSON version of the page.

## How we'll know it's done

1. Status rules have tests that drive each state: a single failure stays Working; two failures in a row show Broken with the right time; a stale check shows Not checked recently; a missing test event shows No test event available. These run before anything relies on them.
2. A check-only call against each source's scraper returns parsed fields, and leaves no new row in the events, source-link and image tables and no search sync.
3. After deploy, the live page shows the states below. Link lines settle within about 2 hours. Finding lines settle after their next cron runs. Facebook watched pages needs two failed runs in a row, so it turns Broken within about 12 hours:
   - Working: Facebook link, Facebook partner pages, Meetup (both lines) and Luma (both lines).
   - Broken: Facebook watched pages.
   - Working or No test event available: Eventbrite link.
   - Not set up: Eventbrite finding.
4. The page shows no event names, account names, URLs or error text, and `anon` still gets no rows from `service_health_events`.
5. The user's grok-bot routine reads the page and reports the Facebook watched-pages problem once.
