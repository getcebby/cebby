# @service/eventbrite

Eventbrite as a Cebby ingest platform.

`DEFAULT_SOURCE_PRIORITY` in `services/core` already lists `eventbrite`. Account
kind `eventbrite_organizer` has been reserved in schema comments since v2.

## Status

- **Single-URL import works.** `eventbrite-scraper` imports one event from a URL
  (admin `/scrape`, source Eventbrite).
- **Organizer calendar sync is still a scaffold.** `retrieve-and-sync-to-db-eventbrite-events`
  returns `501`, and the cron migration is **commented out** so production does
  not fan out empty work.

### How pages are read

The scraper reads `props.pageProps.context` from the page's `__NEXT_DATA__`:
`basicInfo` (UTC start/end, venue with coordinates, organizer id/URL, `isFree`,
`isParentEvent`/`seriesId`) and `structuredContent` (the full description as
HTML, converted to plain text). If that blob is missing it falls back to the
schema.org `Event` block.

A **series parent** (`isParentEvent: true`) spans every date in the series,
e.g. 2026 → 2029, so it is rejected with a 422 asking for a single date's URL.
Without `__NEXT_DATA__`, an event longer than seven days is treated the same way.

Tests: `pnpm --filter @service/eventbrite test`. The fixtures in
`tests/fixtures/` are trimmed copies of two real pages, one date and its series parent.

## Shape (mirrors Meetup / Luma)

| Piece | Role |
| --- | --- |
| `eventbrite-scraper` | Manual single-URL ingest (admin `/scrape`) |
| `retrieve-and-sync-to-db-eventbrite-events` | Per-account fan-out target |
| `cron-sync-eventbrite-organizers` | Optional orchestrator (lists active accounts) |
| `accounts.type` | `eventbrite` |
| `accounts.kind` | `eventbrite_organizer` |
| `accounts.discovery_path` | Organizer vanity / org slug used to list events |
| `event_source_links.source` | `eventbrite` |
| `ingest_kind` | `public_scrape` (upgrade to `public_api` if we get API keys) |

## TODOs before production

1. ~~Implement `fetchEventbriteEvent(url)`~~ (done: `__NEXT_DATA__` with schema.org fallback).
2. Implement `fetchEventsForEventbriteOrganizer(discovery_path)`.
3. ~~Map into `IngestEvent`~~ (done: `toIngestEvent`; organizers become `eventbrite_organizer` accounts keyed by Eventbrite organizer id, with the slug in `account_details.path`).
4. Schedule the cron in a new follow-up migration (the commented block in `services/core/supabase/migrations/20261026020000_eventbrite_scaffold.sql` shows the call; editing that file after it has run won't re-apply it) and deploy functions.
5. Seed vetted Cebu tech organizers as `accounts` rows (do **not** invent orgs).
6. Wire admin add-watch (or a Luma-style path) so operators are not forced into SQL.

## One-shot listings

Use admin `/scrape` with source Eventbrite and the URL of a single date.
