# @service/eventbrite

Eventbrite as a Cebby ingest platform.

`DEFAULT_SOURCE_PRIORITY` in `services/core` already lists `eventbrite`. Account
kind `eventbrite_organizer` has been reserved in schema comments since v2.

## Status

- **Single-URL import works.** `eventbrite-scraper` imports one event from a URL
  (admin `/scrape`, source Eventbrite).
- **Organizer sync runs every 6 hours** (pg_cron `sync-eventbrite-accounts` at :45,
  migration `20261105010000_eventbrite_finding.sql`). `retrieve-and-sync-to-db-eventbrite-events`
  reads each active organizer and imports its events that count for Cebby: in person
  in Cebu, or online when the account is Cebu-based (`accounts.is_cebu_based`). A
  series becomes its next 2 dates within 60 days. See ARCHITECTURE.md and
  `docs/superpowers/specs/2026-11-05-eventbrite-finding-design.md`.

### How organizers are read

`_shared/organizer-api.ts` calls the keyless endpoints Eventbrite's own pages use:
`/api/v3/organizers/{id}/` (does it exist), `/organizer-profile/api/organizers/{id}/events/`
(upcoming events, series collapsed to their next date), `/api/v3/events/{id}/`
(`is_series_parent`) and `/api/v3/series/{id}/events/` (a series' dates).
`_shared/discovery.ts` picks what to import, `_shared/import-event.ts` saves each
date the same way as a pasted link, and `_shared/sync-organizer.ts` ties them
together. The fixtures in `tests/fixtures/organizer/` were captured on 2026-11-05.

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
| `retrieve-and-sync-to-db-eventbrite-events` | Per-organizer sync, called by pg_cron's fan-out |
| `cron-sync-eventbrite-organizers` | Unused manual orchestrator (pg_cron fans out instead) |
| `accounts.type` | `eventbrite` |
| `accounts.kind` | `eventbrite_organizer` |
| `accounts.account_id` | Eventbrite organizer id (what the sync reads) |
| `accounts.is_cebu_based` | Whether its online events count |
| `event_source_links.source` | `eventbrite` |
| `ingest_kind` | `public_scrape` (upgrade to `public_api` if we get API keys) |

## Not done

- Finding organizers Cebby doesn't know: Eventbrite's search pages return no results to a script.
- Dates removed from Eventbrite after import stay in Cebby.

## One-shot listings

Use admin `/scrape` with source Eventbrite and the URL of a single date.
