# Cebby

Cebby is a public discovery layer for Cebu tech events. It is not an event organizer or ticketing authority; the product should earn trust by showing where each listing came from, when it was checked, and how mistakes can be corrected.

This README is intentionally a trust and orientation document. It describes what the system does and where accountability lives, not a playbook for reproducing the ingestion pipeline.

## Trust Model

- **Source-backed listings** - event pages are designed to show where a listing came from and when it was last checked.
- **Visible confidence labels** - listings can be marked as `Official source`, `Imported`, `Community source`, or `Needs review`.
- **Canonical event records** - duplicate or cross-posted events are consolidated so users see one event with clear attribution instead of a noisy feed.
- **Human review path** - operators can review sources, organizers, canonical source, visibility, merge state, and attribution in the admin app.
- **Public/private boundary** - source metadata is public for attribution, while raw scrape payloads, secrets, profiles, and registration data stay out of public reads.

Public-facing explanation lives in `apps/pwa/src/pages/how-cebby-verifies-events.astro`.

## What Is Here

### Apps

- `apps/pwa` - active public app. Astro 5, Cloudflare adapter, PWA support, Tailwind, auth, Supabase, search, calendar feeds, saved events, venue pages, partner pages, and trust-facing public docs.
- `apps/admin` - local/operator Astro app for event review, source accounts, canonical links, merge flows, organizer attribution, and moderation status.

### Services

- `services/core` - Supabase v2 schema, migrations, seeds, shared Deno helpers, service-health SQL, ingestion helpers, and maintenance scripts.
- `services/facebook` - source adapter and ingestion service for one event platform.
- `services/luma` - source adapter and ingestion service for one event platform.
- `services/meetup` - source adapter and ingestion service for one event platform.
- `services/typesense` - event search index sync.
- `services/email` - registration confirmation email processing, templates, QR generation, and mailer helpers.

### Shared Packages

- `packages/ui` - small shared React component package.
- `packages/eslint-config` - shared ESLint config.
- `packages/typescript-config` - shared TypeScript config.

## Architecture Notes

- Package management is pnpm, with workspaces under `apps/*`, `packages/*`, and `services/*`.
- Task orchestration is Turborepo.
- The public app targets Cloudflare Pages and uses externally hosted event imagery.
- Data lives in the Supabase v2 schema documented in `services/core/supabase/migrations/README.md`.
- Event ingestion runs through service-owned background jobs and source adapters.
- Search is backed by a dedicated index sync service.

## WebMCP Integration

The PWA includes WebMCP (Web Model Context Protocol) integration for browser-based AI agents. WebMCP is a W3C WebML Community Group draft browser API that allows web pages to register tools for in-browser AI agents.

**Key features:**
- Read-only tools for event discovery (search, get event details)
- Page-scoped tools for event detail and calendar pages
- Feature detection ensures zero impact on non-supporting browsers
- Comprehensive test harness included for development

**Documentation:**
- See `apps/pwa/src/lib/webmcp/README.md` for complete documentation
- Test page: `/webmcp-test.html` (development only)

**References:**
- [W3C WebML CG Draft](https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/webmcp/agentic-javascript-tools.md)
- [Chrome Documentation](https://developer.chrome.com/docs/ai/webmcp/imperative-api)
