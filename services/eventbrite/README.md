# @service/eventbrite

Scaffold to unpark Eventbrite as a first-class Cebby ingest platform.

`DEFAULT_SOURCE_PRIORITY` in `services/core` already lists `eventbrite`. Account
kind `eventbrite_organizer` has been reserved in schema comments since v2.

## Status

**Scaffold only.** Edge functions return explicit `501 Not Implemented` until the
HTML/API scraper lands. Cron migration is **commented out** so production does
not fan out empty work.

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

1. Implement `fetchEventbriteEvent(url)` — prefer JSON-LD / `__NEXT_DATA__` / public API.
2. Implement `fetchEventsForOrganizer(discovery_path)`.
3. Map into `IngestEvent` with `source: 'eventbrite'`, organizer via `findOrCreateAccount`.
4. Uncomment cron in `services/core/supabase/migrations/20260922000000_eventbrite_scaffold.sql` (or a follow-up migration) and deploy functions.
5. Seed vetted Cebu tech organizers as `accounts` rows (do **not** invent orgs).
6. Wire admin add-watch (or a Luma-style path) so operators are not forced into SQL.

## One-shot listings

Until the scraper ships, one-off Eventbrite events go through admin
`/events/new` → `POST /api/events/manual` (source=`website` when a URL is set).
