# Cebby — Architecture Reference

> Synthesized 2026-04-28 from a full repo exploration. Companion to `.impeccable.md` (which is the *product/design* source of truth — this file is the *engineering* one).
>
> When the codebase materially shifts, update this file in place — don't fork into ad-hoc docs.

---

## What Cebby Is

A **public-utility directory of Cebu tech events** that aggregates from Luma / Eventbrite / Meetup / Facebook into a single calm, glanceable feed. See `.impeccable.md` for the full product spec — short version: **read-only directory**, not an RSVP/organizer/community tool. Light mode only. Soft-3D dimensional minimalism via CSS.

---

## Repo Layout

Turborepo + pnpm workspaces. Workspace globs in `pnpm-workspace.yaml`: `apps/*`, `packages/*`, `services/*`.

```
cebby/
├── apps/
│   ├── pwa/        ← Astro 5 + Cloudflare Workers — THE LIVE PRODUCT
│   ├── web/        ← Next.js 14 — legacy, dormant, shares Supabase project
│   └── raycast/    ← stub
├── services/                   ← Deno edge functions (Supabase)
│   ├── core/       ← shared schema + types + queue (NOT a deployed function)
│   ├── facebook/   ← FB event scraper (manual + cron)
│   ├── luma/       ← Luma event scraper via JSON-LD (manual + cron)
│   ├── meetup/     ← stub
│   └── email/      ← email_queue digest processor
├── packages/
│   ├── ui/         ← minimal shared component lib (largely unused)
│   ├── eslint-config/
│   └── typescript-config/
├── .impeccable.md  ← product/design source of truth (READ FIRST for UI work)
├── ARCHITECTURE.md ← this file (READ FIRST for engineering work)
├── turbo.json      ← build/dev/lint pipeline
├── pnpm-workspace.yaml
└── README.md       ← STILL the Turborepo starter template — ignore it
```

> **Heads-up**: root `README.md` and `package.json` (`"name": "my-turborepo"`) are unchanged Turborepo starter boilerplate. Don't trust them for project info.

---

## Apps

### `apps/pwa` — Astro 5 + Cloudflare Workers (production)

The live product. All feature work happens here.

**Stack**:
- Astro 5.1 with `@astrojs/cloudflare` SSR adapter
- `@vite-pwa/astro` — service worker (Workbox), manifest, install prompts
- `@supabase/supabase-js` — read-side data
- `typesense` — full-text search
- `@logto/browser` — optional auth via PKCE
- `ical-generator` — calendar subscription feeds
- Tailwind + hand-authored CSS keyframes (no Framer Motion — Astro SSR incompatibility)

**Directory structure**:
```
apps/pwa/src/
├── pages/                  # Astro file-based routes
│   ├── index.astro         # Homepage / event hero
│   ├── events.astro        # Event list + filters
│   ├── calendar.astro      # Month/week grid + iCal export
│   ├── saved.astro         # localStorage-backed bookmarks
│   ├── search.astro        # Typesense live search
│   ├── [...slug].astro     # Event detail (slug-driven)
│   ├── profile.astro       # Logto profile (auth-gated)
│   ├── design-preview.astro # Design system reference impl
│   ├── admin-rsvp.astro    # Dormant — old RSVP admin
│   └── about.astro / terms.astro / privacy.astro
├── components/             # Astro components (some islands)
│   ├── BottomTabDock.astro # Mobile nav (Events / Calendar / Saved)
│   ├── EventCard.astro
│   ├── EventMap.astro      # Google Maps embed
│   ├── SaveEventButton.astro
│   ├── RsvpButton.astro    # Deep-link to source platform
│   ├── SmartRSVPButton.astro # DEPRECATED — exists but not surfaced
│   ├── Search.astro
│   ├── ReloadPrompt.astro  # SW update notice
│   └── AppHeader / Footer
├── layouts/
│   └── Layout.astro        # Master template + View Transitions setup
├── lib/
│   ├── supabase.ts         # Supabase client singleton
│   ├── typesense.ts
│   ├── auth-client.ts      # Logto SPA PKCE
│   ├── auth-utils.ts       # JWT decode, token utils
│   ├── server-auth-utils.ts
│   └── event-utils.ts      # Filter/sort/slug helpers
├── store/
│   ├── searchStore.ts      # localStorage recent searches
│   └── syncQueue.ts        # Offline event sync queue
├── styles/
│   └── animations.css      # Custom keyframes (typing, erasing, VT)
├── types/
└── assets/
```

**Config files**:
- `astro.config.mjs` — Cloudflare adapter, Workbox config, `env` schema
- `tailwind.config.*` — design tokens, custom keyframes
- `wrangler.toml` (in `.wrangler/`) — Cloudflare Workers config

### `apps/web` — Next.js 14 (legacy)

Coexisting App Router + Pages Router. Uses `@supabase/ssr`, `framer-motion`, `react-big-calendar`. Same Supabase project as PWA. **Don't develop here** unless explicitly migrating something out.

### `apps/raycast` — empty stub.

---

## Services

Each service is a Deno-runtime Supabase Edge Function bundle with its own `supabase/functions/` directory. They share schema via the `core` package.

### `services/core` — shared layer (NOT deployed)

- `supabase/migrations/` — **single source of truth for schema** (all services share one Supabase project)
  - `20241130041708_remote_schema.sql` — initial: `accounts`, `events`, `facebook_pages`
  - `20241202093140_event_slugs_table.sql` — denormalized slug routing
  - … (intermediate migrations) …
  - `20260428120000_change_account_and_source_id_to_text.sql` — bigint→text on account_id / source_id (enables alphanumeric Luma/Meetup IDs)
  - `20260428130000_multi_org_and_source_links.sql` — `organizations`, `event_source_links`, `event_organizers` tables; pg_trgm + matcher RPC; backfill
  - `20250813000000_setup_email_queue_system.sql` — `email_queue` table
  - `20250813010000_setup_email_cron.sql` — pg_cron triggers
- `supabase/shared/`
  - `database.types.ts` — auto-generated Supabase types (regenerate via Supabase CLI when schema changes)
  - `types.ts` — exported aliases (`Event`, `Account`, etc.)
  - `client.ts` — Supabase client factory (Deno-compatible)
  - `queue.ts` — email/task queue helpers
- `supabase/features/events/index.ts` — the **ingest pipeline**: `ingestEvents(IngestEvent[])` runs the matcher, writes to `events`/`event_source_links`/`event_organizers`, conditionally promotes canonical content per source-priority. Plus `findOrCreateAccount()` for scrapers and post-ingest enrichment helpers (`storeCoverImages`, `geocodeEventLocations`, `getEventsByIds`).
- `supabase/seeds/` — test data
- `docs/` — service-specific notes

### Database tables (canonical)

| Table | Purpose | Key columns |
|---|---|---|
| `organizations` | Editorial unit (PizzaPy, JSCebu, GOAB, …) | `id`, `name`, `slug`, `source_priority text[]`, `is_individual` |
| `accounts` | Platform-presences (one FB page, one Luma calendar, …) | `account_id` text, `kind` (`fb_page`/`luma_calendar`/…), `organization_id` FK → organizations, `name`, `is_active` |
| `events` | Canonical events | `id`, `name`, `description`, `start_time`, …, `primary_source_link_id` FK → event_source_links, `slug`, `is_hidden` |
| `event_source_links` | Where each event was found | `event_id` FK, `source`, `source_id`, `url`, `scraped_at`, `raw jsonb`. UNIQUE(source, source_id). |
| `event_organizers` | events ↔ accounts junction | `event_id` FK, `account_id` FK, `role`, `position`. PK (event_id, account_id). |
| `event_slugs` | URL routing | denormalized slug→event lookup |
| `email_queue` | Async digests/notifications | pg_cron-driven |

**Dedup + multi-source model**:
- A single real-world event = one row in `events`
- Each platform we found it on = a row in `event_source_links` (so an event on Luma + FB + Meetup has 3 source-link rows pointing at the same event)
- `event_source_links.UNIQUE(source, source_id)` is the dedup constraint (replaces the legacy `events.source_id` UNIQUE during transition — the old column is kept as a safety net)
- The "is this scrape a new event or a new presence of an existing event?" decision is made by `find_event_matches()` RPC at ingest time (pg_trgm trigram similarity ≥ 0.7 on names within ±1 day of start_time)
- `events.primary_source_link_id` points at whichever source-link is currently authoritative for the event's content; flipped per the owning organization's `source_priority`
- Events with multiple co-organizing accounts (e.g., PizzaPy + JSCebu + AWSUG joint event) get one row per host in `event_organizers`

### `services/facebook` — FB scraper

```
supabase/functions/
├── fb-scraper/                       # Manual: POST a FB event URL → upsert
│   └── index.ts
├── cron-sync-facebook-accounts/      # Cron: iterate active accounts daily
│   └── index.ts
├── retrieve-and-sync-to-db-events/   # Cron helper: batch process feeds
│   └── index.ts
├── _shared/
│   └── fbutils.ts                    # FB API common code
└── import_map.json                   # Deno import map
```

Uses the `facebook-event-scraper` npm package (works in Deno via `npm:` specifier). Long-lived FB tokens stored on `accounts.page_access_token`.

### `services/email` — digest processor

```
supabase/functions/
└── process-event-registrations/      # Polls email_queue, sends emails
    └── index.ts
```

Likely uses Resend (TBC). Decoupled architecture: writes queue rows synchronously, ships emails async.

### `services/luma` — Luma scraper

Pulls events from lu.ma without using Luma's paid API. Extracts the `__NEXT_DATA__` JSON blob that Luma's Next.js pages embed for hydration — this carries far more data than schema.org JSON-LD, including coordinates, location_type, the stable `api_id`, and a structured rich-text description tree. Zero external dependencies.

```
supabase/functions/
├── luma-scraper/                          # Manual: POST { url } → upsert one event
│   └── index.ts
├── cron-sync-luma-calendars/              # Cron: iterate active Luma accounts, fan out
│   └── index.ts
├── retrieve-and-sync-to-db-luma-events/   # Per-account batch processor
│   └── index.ts
├── _shared/
│   ├── lumautils.ts                       # __NEXT_DATA__ + api2.luma.com extraction
│   └── types.ts                           # LumaEvent, LumaAccountDetails
└── import_map.json
```

**Account shape**: a Luma account row has `type='luma'`, `is_active=true`, and `account_details` JSON with `{ "path": "awsugcebu", "label": "AWS User Group Cebu" }`. The `path` is either a calendar slug (e.g. `goab`, `awsugcebu`) or a user handle path (e.g. `user/lisksea`) — both are supported via different code paths. `access_token`/`page_access_token` columns are unused for Luma (no auth needed).

**Two ingestion paths** based on the `path` shape:
1. **Calendar slugs** — server-rendered. Events come from `__NEXT_DATA__.props.pageProps.initialData.data.featured_items` directly.
2. **`user/{handle}` paths** — client-rendered. Extracts `user.api_id` from the page, then hits `https://api2.luma.com/user/profile/events-hosting?period=future&user_api_id=…` for the event list.

**Dedup**: `events.source_id` stores Luma's stable `api_id` (e.g. `evt-DGc0j5LmlqV1z`). Survives slug renames.

**Coords come free**: Luma's `geo_address_info.{latitude, longitude}` populates `events.location_details` directly during ingest — no Google Geocoding call needed for events that have it.

**Past events filtered** at ingest time so the cron run is bounded by upcoming-event count rather than calendar history depth.

**v1 known gaps**:
- No pagination on calendar pages — only events visible in the initial `featured_items` are picked up
- No retries on transient HTTP failures (per-event detail fetch falls back to the calendar stub if the detail page errors, so events still get saved)
- The api2.luma.com endpoint is reverse-engineered (same one Luma's site uses) — will need adapting if Luma changes their internal API

### `services/meetup` — empty stub.

---

## Packages

### `packages/ui`

Minimal shared component lib. Exports (per `package.json`): `./button`, `./card`, `./code`. **Largely dormant** — apps define their own components inline (e.g., `EventCard` in PWA). Don't add to it without a strong reason; the trend is the other direction.

### `packages/eslint-config`, `packages/typescript-config`

Shared lint + tsconfig bases.

---

## Cross-Cutting Concerns

### Auth — Logto (optional)

- External IdP at `https://auth.gocebby.com`
- PKCE flow (public SPA, no client secret)
- Scopes: `openid profile email`
- Token cache on `window.__logtoClient`
- **Most features work unauthed.** Saved events live in `localStorage`. Auth is needed for things like Cebby Wrapped — not for browsing or saving.
- Server-side auth helpers in `apps/pwa/src/lib/server-auth-utils.ts`

### Styling

- **Tailwind 3.4+**, light mode only
- Design tokens defined in `.impeccable.md` "Design Tokens" section. Reference impl: `apps/pwa/src/pages/design-preview.astro`
- Three-tier shadow scale: `shadow-soft-1/2/3` + dedicated CTA shadow
- Forbidden colors/utilities: `neon-purple`, `neon-blue`, `neon-pink`, `spotify-green` (legacy/dead)
- Forbidden animations: `gradientBG`, `floatShape`, `glitch*`, `shimmer`, `sparkle`, `bounceIn`, `popIn`, `zoomInOut`

### Motion

CSS-only. No JS animation libraries on the PWA.
- `@view-transition` rules in `apps/pwa/src/layouts/Layout.astro`
- Per-component `view-transition-name` properties for morphs
- **Viewport-gated VT names** via IntersectionObserver — long-distance morphs from off-screen sources read as "fly-up from nowhere" (this is a recurring pain point in git history)
- Press feedback only via `transform: scale()` (GPU compositor path)
- Custom keyframes in `apps/pwa/src/styles/animations.css`
- `prefers-reduced-motion` respected

### PWA features

- Manifest via `@vite-pwa/astro`: shortcuts to `/events` and `/calendar`, `display: standalone`, `web+cebby` protocol handler
- Service worker (Workbox runtime caching):
  - `CacheFirst` — Google Fonts (365 days)
  - `StaleWhileRevalidate` — pages (4hr), images (30 days)
- iOS support: web-app-capable meta + 14 Apple touch splash variants
- `ReloadPrompt.astro` — prompts users when SW updates

### State management

**No global state manager** (no Redux/Zustand/Jotai). Three patterns:
1. `localStorage` — saved event IDs, recent searches (`apps/pwa/src/store/`)
2. `window.__logtoClient` — auth singleton
3. Astro SSR + props through islands

Adding a state manager here is over-engineering — Cebby is read-heavy.

### Data flow

| Direction | How |
|---|---|
| App → DB read | Supabase JS client (anon key + RLS) |
| App → search | Typesense client (search-only key) |
| App → DB write | None (apps don't write event data) |
| Service → DB write | Supabase service role from edge functions |
| DB → Typesense sync | GitHub Action `.github/workflows/sync-typesense.yml` (NOT real-time) |
| Service → email | Email queue → cron processor |

### Environment variables (PWA, via `astro.config.mjs` `env` schema)

```
PUBLIC_SUPABASE_URL
PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY            # server only
PUBLIC_TYPESENSE_HOST
PUBLIC_TYPESENSE_PORT
PUBLIC_TYPESENSE_PROTOCOL
PUBLIC_TYPESENSE_SEARCH_KEY
PUBLIC_GOOGLE_MAPS_KEY
NOTION_API_KEY                        # admin features
NOTION_DATABASE_ID
ADMIN_PASSWORD                        # basic-auth fallback
```

### CI/CD

`.github/workflows/`:
- `deploy-services.yml` — runs migrations + deploys functions when `services/**` changes
- `sync-typesense.yml` — re-indexes events into Typesense

GitHub secrets needed: `SUPABASE_PROJECT_ID`, `SUPABASE_ACCESS_TOKEN`.

PWA deploys to Cloudflare Workers (the `.wrangler/` dir confirms it's wired).

---

## Conventions

- TypeScript strict mode everywhere
- React components: PascalCase. Astro components: PascalCase too.
- Tailwind utility-first; no BEM
- Migrations: `YYYYMMDDHHMMSS_descriptive_name.sql` (timestamp-prefixed)
- Edge functions: one folder per function, `index.ts` entry point, optional `_shared/` for cross-function code
- Imports in services: `import_map.json` for Deno specifiers (`npm:`, `jsr:`, `https:`)
- Identifiers in DB: snake_case
- Type aliases: re-exported from `services/core/supabase/shared/types.ts` — apps + services consume from there

---

## How to Add a New Event Source (e.g., Luma, Meetup)

This is the canonical pattern — mirror the `services/facebook/` structure:

1. **Schema check** — does `events.source` need a new value? It's currently a free-form text field; just add `'luma'`. No migration needed unless you want to constrain it via CHECK or enum.
2. **Account model** — `accounts` table is currently FB-shaped (`page_access_token`). For Luma, decide:
   - Reuse `accounts` and treat `page_access_token` loosely (any auth token), OR
   - Add provider-specific columns via migration in `services/core/supabase/migrations/`
3. **Service scaffold** — `services/luma/` with:
   - `package.json`, `deno.json`, `import_map.json`
   - `supabase/functions/luma-scraper/index.ts` — manual one-off ingestion
   - `supabase/functions/cron-sync-luma-calendars/index.ts` — periodic sync
   - `_shared/lumautils.ts` — common API/scraping logic
4. **Shared imports** — pull types + client from `@service/core/supabase/shared`
5. **Upsert pattern** — write events with `source: 'luma'`, `source_id: <luma event id>`. The `(source, source_id)` pair handles dedup.
6. **Deploy wiring** — `.github/workflows/deploy-services.yml` already triggers on `services/**` changes; verify the matrix includes the new dir or add it explicitly.
7. **Cron schedule** — add a pg_cron job in a new migration that pings the function URL, mirroring how `cron-sync-facebook-accounts` is wired.

---

## Dormant Areas — Don't Touch Unless Reviving

Per `.impeccable.md` and historical decisions:
- `apps/web` — legacy Next.js
- `apps/raycast` — empty stub
- `services/meetup` — empty stub
- `apps/pwa/src/components/SmartRSVPButton.astro` — exists, not surfaced
- `apps/pwa/src/pages/admin-rsvp.astro` — old RSVP admin
- Auth profile pages beyond minimal (Logto is for Wrapped only)
- Any forbidden ambient animation (see Motion section)
- `bg-gradient.png` background asset (replaced by CSS multi-radial)

---

## Quick File Reference

| Question | File |
|---|---|
| What is the product? | `.impeccable.md` |
| What is the architecture? | `ARCHITECTURE.md` (this file) |
| Cloudflare/PWA/Workbox config | `apps/pwa/astro.config.mjs` |
| View Transitions setup | `apps/pwa/src/layouts/Layout.astro` |
| Custom keyframes | `apps/pwa/src/styles/animations.css` |
| Database schema | `services/core/supabase/migrations/` |
| Shared DB types | `services/core/supabase/shared/types.ts` |
| Supabase client factory | `services/core/supabase/shared/client.ts` |
| Email queue helpers | `services/core/supabase/shared/queue.ts` |
| FB scraper entrypoint | `services/facebook/supabase/functions/fb-scraper/index.ts` |
| Service deploy CI | `.github/workflows/deploy-services.yml` |
| Search re-index CI | `.github/workflows/sync-typesense.yml` |
| Design system reference UI | `apps/pwa/src/pages/design-preview.astro` |
| Turbo task pipeline | `turbo.json` |
| Workspace globs | `pnpm-workspace.yaml` |

---

## Where to Start by Goal

| Goal | Open this |
|---|---|
| Understand the product vision | `.impeccable.md` |
| Touch the live UI | `apps/pwa/src/pages/` then `apps/pwa/src/components/` |
| Add a new event source | This doc's "How to Add a New Event Source" section, then `services/facebook/` as the pattern |
| Tweak motion | `apps/pwa/src/styles/animations.css` + `view-transition-name` properties on components |
| Add/change a DB table | New file in `services/core/supabase/migrations/` then regen `database.types.ts` |
| Modify auth | `apps/pwa/src/lib/auth-client.ts` + `auth-utils.ts` |
| Change deploy behavior | `.github/workflows/deploy-services.yml` |
| Update search indexing | `.github/workflows/sync-typesense.yml` + `apps/pwa/src/lib/typesense.ts` |
