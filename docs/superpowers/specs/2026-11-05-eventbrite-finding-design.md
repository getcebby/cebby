# Eventbrite: finding new events (design, 2026-11-05)

## Why

[/status](https://www.getcebby.com/status) shows Eventbrite "Finding new events" as **Not configured**, and that's accurate. Eventbrite discovery has never run:

- `retrieve-and-sync-to-db-eventbrite-events` is a stub that returns 501.
- `fetchEventsForEventbriteOrganizer` throws.
- The 6-hourly cron is commented out in `20261026020000_eventbrite_scaffold.sql`.

The only Eventbrite organizer Cebby has is Code Orange Dev School (`110850996031`). It was created on 2026-10-26 as a side effect of importing Bitcoin Meetup Cebu by link. The two Eventbrite events in Cebby both came from link imports.

Dorell wants Eventbrite to find new events the same way Luma, Meetup and Facebook already do: watch a list of accounts and read each one every 6 hours.

## Decisions (Dorell's, 2026-11-05)

1. **A watch list of Eventbrite organizers,** read every 6 hours like the other platforms. `/status` shows Eventbrite "Finding new events" as a real finding line.
2. **Which events get imported.** Only events in Cebu, and only tech events:

   | The event is… | Organizer marked Cebu-based | Any other organizer |
   |---|---|---|
   | In person, in Cebu | import | import |
   | Online | import | skip |
   | In person, outside Cebu | skip | skip |
   | Cancelled | skip | skip |

   The same rule will apply to every platform (follow-up 2). Organizers based elsewhere still count whenever their event is held in Cebu.
3. **"Tech" is decided per organizer, not per event,** as with Luma and Meetup. Only tech organizers go on the list, and every qualifying event they run is imported and published. A non-tech stray gets hidden in the admin app until there's a way to classify events (follow-up 3). Eventbrite's categories can't decide it (see Evidence).
4. **"Cebu-based" is a column on `accounts`, set per account by Dorell.** It's meant for every platform, but in this project only Eventbrite reads it. Eventbrite doesn't say where an organizer is based. New accounts, including those created by a link import, start as not Cebu-based.
5. **Repeating events (series): import the next 2 dates, as long as they're within 60 days.** One-off events are imported however far ahead they are. Dates already imported are never deleted by this.
6. **How organizers get on the list:**
   - Importing an Eventbrite event by link adds its organizer. This already happens: `findOrCreateAccount` creates it active.
   - A new admin "Watch an Eventbrite organizer" form takes an organizer link or id and a Cebu-based checkbox.
   - Dorell can change an Eventbrite organizer's Cebu-based flag and turn it off.
7. **No API key.** Use the keyless endpoints Eventbrite's own pages call (see Evidence). The official API needs an OAuth token.

## Goals, non-goals, anti-goals

- **Goals:**
  - Cebu tech events from watched Eventbrite organizers appear on Cebby within 6 hours of being listed.
  - `/status` tells the truth about whether that reading works.
- **Non-goals:**
  - Finding organizers Cebby doesn't know yet. Eventbrite's search pages return no results to a script; they fill in later in the browser through a CSRF-protected request.
  - Removing or cancelling dates that were already imported.
  - Applying the Cebu rule to Facebook, Luma or Meetup, and their account toggles (follow-up 2).
  - Classifying events as tech automatically (follow-up 3).
  - Changing the hourly link check.
- **Anti-goals (a failure even if it "works"):**
  - **A quiet organizer reads as failed.** That is the bug Facebook's watched pages had: an organizer with nothing upcoming has been read.
  - **A deleted or wrong organizer id reads as fine.** The events endpoint answers both with the same empty list, so this needs its own check.
  - **Years of copies of one series.** Bitcoin Meetup Cebu lists 39 dates through 2029.
  - **Code Orange's Bali or online events show up on Cebby.**
  - **Counts on `/status` or its anon RPCs.** No counts of accounts, pages, groups or checks; see memory `feedback_status_no_public_counts`.

## Evidence (recon on 2026-11-05, live, logged out, no key)

- **E1. An organizer's upcoming events:** `GET https://www.eventbrite.com/organizer-profile/api/organizers/{id}/events/?page=1&pageSize=50`. This is what the organizer page's "show more" calls; the path prefix is the page's `basePath`, `/organizer-profile`.
  - **Response:** `{"events": [...], "hasMore": bool, "total": n}`.
  - **Each event carries:**
    - `id`, `name`, `url`
    - `start_date`, `start_time`, `timezone`
    - `is_online_event`, `is_cancelled`
    - `primary_venue.address` (`city`, `region`, `country`, `localized_address_display`)
  - **Series appear once,** under the series parent's id at its next date. `series_id` is null in this response even for a parent.
  - **Code Orange:** 17 events, `hasMore: false`. One is in Cebu (Bitcoin Meetup Cebu, parent `2002279245122`), 5 are in Bali and 11 are online.
  - **A bad id** (`99999999999`) returns `200` with `{"events":[],"hasMore":false,"total":0}`, exactly like Women Techmakers Cebu (`109571894561`, nothing upcoming).
- **E2. Does the organizer exist:** `GET https://www.eventbrite.com/api/v3/organizers/{id}/`. It returns `200` with the organizer for a real id, and `404 {"error":"NOT_FOUND",…}` for a bad one.
- **E3. Event detail:** `GET https://www.eventbrite.com/api/v3/events/{id}/` returns `is_series`, `is_series_parent`, `series_id`, `online_event` and `status`. Both series parents tested return `is_series_parent: true`.
- **E4. A series' dates:** `GET https://www.eventbrite.com/api/v3/series/{parent_id}/events/?time_filter=current_future&expand=venue`. For Bitcoin Meetup Cebu it returned 39 dates, each with its own id. Nov 6 is `2004210346097`, Dec 4 is `2004210347100`, and Dec 30 is `2002279263176` (already in Cebby).
- **The official API refuses without a token:** `eventbriteapi.com/v3/...` returns `401 NO_AUTH`. The `www.eventbrite.com/api/v3/organizers/{id}/events/` route works without a key but lists every date of every series: 541 entries for Code Orange, in 11 pages. Don't use it.
- **Categories can't decide "tech."** Bitcoin Meetup Cebu has no category, Bitcoin Movie Night is "Film", Sovereign Bitcoiner Workshop is "Business → Finance", and two others are "Science & Technology".
- **Organizers have no location.** Eventbrite's organizer data has `locations: []` for both Code Orange and Women Techmakers Cebu.
- **The timezone can be the organizer's default.** Bitcoin Meetup Cebu reports `Asia/Makassar`, which is UTC+8 like Manila, so the times are right but the label isn't.
- **The existing importer already handles series.** `fetchEventbriteEvent` / `parseEventbriteEventPage` (`_shared/eventbriteutils.ts`) return `{kind: 'series_parent'}` for a parent page, and a single date's page imports normally; the Dec 30 import proves it. The hourly link check skips series parents.
- **Edge functions can reach eventbrite.com.** The link check already fetches eventbrite.com event pages from Supabase every hour. Whether E1, E2 and E4 also answer from Supabase's network is **not yet verified**; recon ran from a laptop.

## How it works

### The per-organizer sync (`retrieve-and-sync-to-db-eventbrite-events`, replacing the stub)

`fan_out_account_syncs('eventbrite', …)` POSTs each active `type = 'eventbrite'` account row. For one organizer:

1. **Organizer id.** Use `accounts.account_id`, the numeric Eventbrite organizer id (also in `account_details.organizer_id`).
2. **Check it exists (E2).**
   - `404`: unread, `read_error: not_found`.
   - Any other non-200: `httpFailure(status, …)`.
   - Non-JSON: `unexpected_page`.
3. **List its events (E1).** Follow `hasMore` with a page cap. A JSON body with an `events` array means the organizer **was read**, even when the array is empty. Anything else is unread, with a cause from the existing `ReadErrorCode` list.
4. **Filter by the decision table,** through the shared rule (see below) with the account's `is_cebu_based`.
   - **"In Cebu":** a physical venue in the Philippines whose city or region is in Cebu: Cebu City or its areas, or another Cebu town. Reuse the town matcher in `services/core/supabase/shared/search-doc.ts`. A bare "Cebu" counts as in Cebu for this filter, even though `normalizeCity` leaves it unknown for the city facet.
   - **Online:** `is_online_event`.
   - **A non-online event with no venue** is skipped.
   - **Cancelled events** are skipped.
5. **Series.** For a listed event that is a series parent (E3), fetch its dates (E4). Keep at most the first 2 that start between now and now + 60 days. Each date's own page is checked against the filter again when it's imported, since a series date can have its own venue. One-off events are kept however far ahead they are.
6. **Import each kept date through the existing link-import path:** `fetchEventbriteEvent` → organizer via `findOrCreateAccount` → `toIngestEvent` → `ingestEvents`. This is the same code `eventbrite-scraper` and the hourly link check exercise. Factor it into `_shared` rather than calling the function over HTTP. Existing events are updated, not duplicated; ingest already keys on the source id.
7. **Write one health row per organizer,** like Meetup:
   - `fingerprint: 'account_processed'` (or `cron_account_failed` on a crash).
   - `metadata: { ingested, ...findingMetadata({ line: 'finding', pageRead, readError }) }`.
   - A failed import of one event doesn't make the organizer unread. Parser breakage is the link line's job. Record per-event failures somewhere the admin Health page can show them (builder's call how).

### The Cebu-based column and the shared rule

- **Column:** `accounts.is_cebu_based boolean NOT NULL DEFAULT false`, added in this project's migration. Every existing account gets `false`. Nothing outside Eventbrite reads it yet, so Facebook, Luma and Meetup behave exactly as before. Follow-up 2 sets it on existing accounts and puts it to use. Regenerate `database.types.ts`.
- **Shared rule:** a pure function in `services/core/supabase/shared/` that takes an event's place (physical address or online) and whether its account is Cebu-based, and answers whether it counts for Cebby (the decision table). Eventbrite calls it now; follow-up 2 calls it from the other platforms. It owns the "in Cebu" matching, reusing the town list in `search-doc.ts`. It returns a verdict, not an action. Eventbrite skips events that don't count; follow-up 2 decides whether existing platforms skip them or import them hidden.
- **Why not `account_details`:** Dorell expects the rule to apply to all platforms, so a typed column that the database enforces fits better than a key in each platform's free-form details.

### SQL (one new migration)

Its timestamp must sort after production's latest, currently `20261104020000`. Re-check `main` before merge (memory `project_migration_ordering`).

- **`accounts.is_cebu_based`:** add the column (see above).
- **`public.finding_targets()`:** active `eventbrite` accounts become `line = 'finding'` targets. There's no `discovery_path` requirement, because the account id is the organizer id. Keep it mirroring the handler's routing.
- **`private.record_finding_runs()`:** add `('eventbrite', 'finding')`.
- **`private.scraper_status_at()`:** the Eventbrite finding line's kind changes from `not_set_up` to `finding`. Same staleness (13h) and rules as the other finding lines.
- **`private.scraper_history_at()`:** check it picks up Eventbrite finding windows. It filters by bucket and `metadata.line`.
- **Cron:** schedule `sync-eventbrite-accounts` at `45 */6 * * *` (Luma :00, Meetup :15, Facebook :30). It runs `private.record_finding_runs('eventbrite')`, then `public.fan_out_account_syncs('eventbrite', 'https://enwcrupzidbcwimyttla.supabase.co/functions/v1/retrieve-and-sync-to-db-eventbrite-events')`.
- **Keep the house rules:**
  - Internal functions stay in `private`, with SECURITY DEFINER wrappers in `public`.
  - Never `REVOKE EXECUTE` on public functions (memory `project_supautils_revoke_segfault`).
  - The anon wrappers' column lists don't change. pgTAP pins them.

### Admin app

- **`/orgs`:** add a "Watch an Eventbrite organizer" form next to the Facebook one.
  - It accepts `eventbrite.com/o/<slug>-<id>`, a bare id, or an event link (whose organizer gets watched), plus a "Cebu-based" checkbox.
  - It validates the organizer with E2 and takes the name from it.
  - It creates the `accounts` row: `account_id` = organizer id, `type = 'eventbrite'`, `kind = 'eventbrite_organizer'`, active, `is_cebu_based` from the checkbox, `account_details {path, organizer_id}`.
  - If the organizer already exists, it says so, like the Facebook form, and applies the checkbox.
- **Editing Eventbrite organizers:** Dorell can set Cebu-based and active/inactive for each one. Where the controls live is the builder's call; a short list on `/orgs` is fine.
- **`/health`:** add Eventbrite "Finding new events" to the lines in `apps/admin/src/lib/health-report.ts`, so organizers that weren't read are listed with their cause.

### PWA

- **`/status`:** no code change is expected, since the line label and states already exist. Verify the Eventbrite finding row renders with bars once it has results.
- **What counts, published (Dorell's ask, 2026-11-05):** add a "What Cebby lists" section to [How Cebby verifies events](https://www.getcebby.com/how-cebby-verifies-events) (`apps/pwa/src/pages/how-cebby-verifies-events.astro`), near the top after the intro, in the page's existing style. Draft copy (polish it, but keep the meaning):

  > **What Cebby lists**
  > Tech events the Cebu tech community can attend.
  > - **In person in Cebu:** events held anywhere in Cebu (Cebu City, Mandaue, Lapu-Lapu, Talisay and nearby towns), whoever organizes them.
  > - **Online:** events run by communities and organizers based in Cebu.
  > - **Not listed:** events held outside Cebu, even by Cebu communities, and online events from organizers based elsewhere.
  > - **Tech only:** Cebby follows tech communities and organizers. If a listing isn't about tech, it gets hidden.

  *Parent session's call:* it ships with this project. It's the rule Dorell already applies by hand, and follow-up 2 makes Facebook, Luma and Meetup enforce it automatically. Until then, a stray from those platforms can briefly break the rule, as it can today.

### Docs

- `ARCHITECTURE.md`: its status rules still say `not_set_up (Eventbrite finding)`, and the Eventbrite parts need updating.
- `services/eventbrite/README.md`: its TODOs.
- Grok routine (spec `2026-11-04-status-diagnostics-design.md` §8): no change. A new line in "Healthy" stays out of the daily list.

## Tests

- **Deno (`services/eventbrite/tests/`),** with fixtures saved from the endpoints above:
  - the decision table, each cell;
  - cancelled events skipped;
  - a non-online event with no venue skipped;
  - a series: the next 2 dates kept, a third inside 60 days dropped, dates beyond 60 days dropped;
  - a one-off event 5 months ahead kept;
  - a quiet organizer (empty list, organizer exists) counts as read;
  - a bad id (E2 `404`) is unread with `not_found`;
  - non-JSON or `5xx` is unread;
  - `hasMore` pagination;
  - a per-event import failure doesn't make the organizer unread.
- **The shared rule (`services/core` tests):** every cell of the decision table, Cebu towns other than Cebu City, a bare "Cebu", a Philippine venue outside Cebu (for example Makati), and a venue abroad.
- **pgTAP:**
  - `accounts.is_cebu_based` exists, is `NOT NULL`, and defaults to `false`;
  - `finding_targets()` includes active Eventbrite organizers and not inactive ones;
  - `record_finding_runs('eventbrite')` writes the expected count;
  - the status function evaluates the Eventbrite finding line, so it's no longer `not_set_up`;
  - the wrapper column pins are unchanged.
- **Admin:** parsing organizer input (URL, id, event link, junk).

## Verification (production, read-only)

Never invoke the function or `private.run_link_checks()` by hand against production. After the deploy:

1. Wait for the next `:45` run.
2. Check, read-only:
   - one Eventbrite `scheduled-run` row with `metadata.expected`;
   - one `account_processed` row for Code Orange with `page_read: true`;
   - Bitcoin Meetup Cebu's next dates imported (its Dec 4 date, and the Jan date once it falls inside 60 days);
   - none of Code Orange's Bali or online events imported.
3. After the run's window counts (an hour old), `/status` shows Eventbrite "Finding new events" as Healthy with a green bar. The anon RPC shows `working`.
4. If E1, E2 or E4 are blocked from Supabase's network, the line goes Unknown and then Broken. The admin Health page shows the cause. That's the test of the edge-network assumption.

## Delivery

One PR from `feat/eventbrite-finding`. Merging deploys the Eventbrite functions and the migration. Dorell reviews and merges. After merge, Dorell adds Women Techmakers Cebu (Cebu-based) and any other organizers through the new form.

## Follow-up projects (agreed order, not built here)

2. **Apply the rule to Facebook, Luma and Meetup.** It gets its own design and PR, because this is where events that show today could disappear. Production on 2026-11-05 (events from the last 6 months and upcoming):
   - **Facebook:** 15 in Cebu, 15 online, and 1 physically elsewhere that's published.
   - **Luma:** 16 in Cebu, 12 online, and 5 elsewhere (Chiang Mai, Davao, Makati, Taguig), all already hidden by hand.
   - **Meetup:** 14 in Cebu, 2 online, and **10 online events stored as in person with "Online event" as the address.**
   
   It needs:
   - Meetup's online detection fixed first.
   - `is_cebu_based` set on existing accounts from a list Dorell reviews. Some watched accounts aren't Cebu-based: DEVCON Philippines, LaravelPH, UXPH.
   - A decision on whether events that don't count are skipped or imported hidden.
   - The shared rule wired into each platform's import.
3. **Hide non-tech events automatically,** once there's a reliable way to classify them. Until then, hiding them by hand in the admin app keeps working.

## Left to the builder

- The page cap for E1 pagination.
- How per-event import failures are recorded.
- Where the admin edit controls live.
- Whether to remove the unused `cron-sync-eventbrite-organizers` stub.
- The exact Cebu matcher wiring.
- Whether to store `Asia/Manila` instead of an organizer-default timezone for Cebu venues.
- *Parent session's call:* online events from a Cebu-based organizer carry Cebu as their city, region and country, the way Luma tags online events from a Cebu calendar (`lumautils.ts`, calendar `geo_*`). Then the site's city filter still finds them.
- *Parent session's call:* between the deploy and the first `:45` run, the line shows the usual "no result yet" state. If that falls across 9 AM, grok's daily list includes it once. No special handling.

Builder check: done by the parent session reading as the builder (no reviewer agent was asked for). Nothing important was left for Dorell; the two calls above were settled here.

## Limitations

- **E1, E2 and E4 are undocumented endpoints** and can change without notice. The per-organizer health rows make that visible on `/status` instead of silent.
- **Finding organizers Cebby doesn't know is out of scope.**
- **A tech organizer's non-tech Cebu event gets published,** and has to be hidden by hand.
- **Dates removed from Eventbrite after import stay in Cebby.**
