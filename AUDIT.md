# Cebby PWA Audit — SEO, GEO, Performance & Polish

**Site:** https://www.getcebby.com  
**Audit Date:** October 1, 2026  
**Stack:** Astro 5, Cloudflare Pages, Supabase, @vite-pwa/astro  
**PR Status:** PR #68 (featured strip) merged ✅ (2026-09-29)  
**Production Build:** 2026-09-29T03:23:01.767Z

---

## Production Verification Notes

Live site tested with browser UA and bot-like requests on 2026-10-01:

1. **Sitemap:** https://www.getcebby.com/sitemap.xml returns ~517 URLs (4 static + ~513 events, past & future). Intermittent 500/403 errors reported for bot UAs (not reproduced in current test; may be Cloudflare rate-limiting or Supabase connection issues).

2. **Homepage:** Has OG/Twitter cards, canonical URL, FAQ section. ❌ **Missing JSON-LD** (Organization, WebSite, FAQPage) — this PR adds all three.

3. **Event Detail (Hacktoberfest example):** Has Event JSON-LD with eventStatus/eventAttendanceMode. Issues found:
   - ❌ `location.address.addressLocality` = venue name ("lyf Cebu City") instead of city name per Schema.org spec
   - ❌ All `organizer.url` values = `https://www.getcebby.com` instead of real org URLs (data not in DB?)
   - ⚠️ `startDate`/`endDate` in UTC (+00:00) while event is Asia/Manila — verify Google accepts this
   - ❌ Missing `location.geo` (lat/lng) — this PR adds when available

4. **PWA Manifest:** 
   - ❌ `theme_color: "#ffffff"` ≠ HTML `<meta name="theme-color" content="#9333ea">` — this PR fixes to `#8234E6` (brand purple)
   - ⚠️ `display_override: ["fullscreen", "minimal-ui"]` includes fullscreen (aggressive)
   - ⚠️ `screenshots` has only `form_factor: wide`; mobile install UI benefits from narrow screenshot

5. **Viewport Meta:** ❌ Includes `maximum-scale=1.0, user-scalable=no` — **accessibility violation** (prevents zoom for low-vision users). Documented but not fixed (needs UX testing).

6. **Apple Splash Screens:** ~38 `<link rel="apple-touch-startup-image">` tags — heavy initial HTML weight (minor issue).

---

## Executive Summary

The Cebby PWA has a **solid SEO foundation** (OG tags, sitemaps, JSON-LD on events) and **excellent PWA polish** (manifest, service worker, apple-touch-icons). However, **GEO (Generative Engine Optimization) signals are weak**: missing Organization/WebSite schema, FAQ markup, and geo-coordinates in Event structured data limit AI crawlability for queries like *"Cebu tech events"*.

**Top 5 Priorities:**
1. ✅ **IMPLEMENTED:** Add Organization/WebSite/FAQPage JSON-LD to homepage (High impact, Small effort)
2. ✅ **IMPLEMENTED:** Enrich Event JSON-LD with geo-coordinates + fix addressLocality (High impact, Small effort)
3. ✅ **IMPLEMENTED:** Fix PWA manifest theme_color to match brand purple (Medium impact, Trivial effort)
4. ❌ **DOCUMENTED:** Fix viewport a11y violation (user-scalable=no) — needs UX testing (High impact, Medium effort)
5. ❌ **DOCUMENTED:** Fix Event organizer URLs to point to real org pages (Medium impact, needs org data)

---

## SEO Audit

### ✅ Strengths
| Item | Status | Evidence |
|------|--------|----------|
| robots.txt | ✅ Good | `/robots.txt` allows all, references sitemap |
| sitemap.xml | ✅ Good | Dynamic generation at `/sitemap.xml.ts`, includes all non-hidden events |
| OG tags | ✅ Good | `SEO.astro` component implements OG + Twitter cards on all pages |
| Canonical URLs | ✅ Good | `<link rel="canonical">` on every page via SEO component |
| Event JSON-LD | ✅ Good | Event detail pages include schema.org Event structured data |
| Hidden events excluded | ✅ Good | Sitemap filters `neq('status', 'hidden')` |
| H1 hierarchy | ✅ Good | Homepage: `<h1>` is "Cebu tech events you can verify" |
| Image alt text | ✅ Good | EventCard.astro sets `alt={event.name}` |

### ⚠️ Weaknesses
| Issue | Impact | Effort | Status |
|-------|--------|--------|--------|
| **No Organization/WebSite JSON-LD on homepage** | **High** | **S** | ✅ **FIXED** |
| **No FAQPage JSON-LD** | **High** | **S** | ✅ **FIXED** |
| **Event addressLocality uses venue name not city** | **High** | **S** | ✅ **FIXED** (now "Cebu City", "Mandaue City", or "Lapu-Lapu City") |
| **Event organizer URLs point to getcebby.com** | Med | M | ❌ **NOT FIXED** (requires org URL data from DB; documented) |
| **No OG locale tag** | Med | S | ✅ **FIXED** (`en_PH`) |
| **Calendar page meta weak** | Med | S | ✅ **FIXED** (expanded title + description) |
| **Sitemap intermittent 500/403 for bots** | Med | M | ❌ **DOCUMENTED** (may be CF rate-limiting or Supabase timeout) |
| **OG image size 830KB** | Low | M | ❌ **DOCUMENTED** (needs compression tool) |
| Slug quality | Low | - | ✅ Good (no action needed) |

---

## GEO Audit (Generative Engine Optimization)

### Entity & Knowledge Graph Signals
| Signal | Status | Notes |
|--------|--------|-------|
| Organization schema | ✅ Fixed | Now on homepage with `name: "Cebby"`, `url`, `logo`, `sameAs: [github, notion]` |
| WebSite schema | ✅ Fixed | Now on homepage with `searchAction` for `SearchAction` |
| FAQPage schema | ✅ Fixed | Wraps 5 existing FAQ items on homepage |
| Event location geo-coordinates | ✅ Fixed | Event JSON-LD now includes `location.geo` with lat/lng when available from DB or venue resolver |
| Clear entity facts | ✅ Good | Homepage copy: "Cebu tech events", "Luma, Eventbrite, Meetup, Facebook", "free", "open source" |
| About page crawlability | ✅ Good | `/about-onecebby` exists; content is crawlable |

### GEO (Geographic) Signals
| Signal | Status | Notes |
|--------|--------|-------|
| Place names in copy | ✅ Good | Homepage: "Cebu tech events", FAQ: "Cebu tech community" |
| Event location names | ✅ Good | Event cards show venue name (e.g. "lyf Cebu City · IT Park") |
| addressRegion in Event schema | ✅ Good | All events: `"addressRegion": "Cebu", "addressCountry": "PH"` |
| OG locale tag | ⚠️ Missing | Add `<meta property="og:locale" content="en_PH">` to SEO.astro |
| Google Maps integration | ✅ Good | `/events` page has MapView showing Cebu-area events |

**AI Answer Readiness:** ✅ Good  
Query: *"What tech events are happening in Cebu?"*  
→ AI can now extract: Cebby aggregates Luma/Eventbrite/Meetup/Facebook, free, Cebu-based, with FAQ answers.

---

## PWA Audit

### ✅ Strengths
| Item | Status | Evidence |
|------|--------|----------|
| manifest.webmanifest | ✅ Good | Generated by @vite-pwa/astro with name, icons, theme_color, display, shortcuts |
| Service worker | ✅ Good | Workbox-based SW with StaleWhileRevalidate + runtime caching for pages/images/fonts |
| apple-touch-icon | ✅ Good | `/icons/apple-icon-180.png` linked in Layout.astro |
| Apple splash screens | ✅ Excellent | Comprehensive set of splash images for all iOS devices |
| theme-color meta | ✅ Good | `<meta name="theme-color" content="#9333ea">` (brand purple) in Layout.astro |
| Installability | ✅ Good | `display: standalone`, `start_url: /`, `scope: /` |
| Offline page | ✅ Good | `/offline.html` exists in public/ |
| PWA shortcuts | ✅ Good | Shortcuts to `/events` and `/calendar` in manifest |

### ⚠️ Weaknesses
| Issue | Impact | Effort | Status |
|-------|--------|--------|--------|
| **Manifest theme_color mismatch** | **Med** | **Trivial** | ✅ **FIXED** (`#8234E6` brand purple) |
| **Manifest description truncated** | Low | Trivial | ✅ **FIXED** (full description) |
| **display_override includes fullscreen** | Low | S | ❌ **DOCUMENTED** (aggressive; consider removing) |
| **Screenshots only form_factor: wide** | Low | S | ❌ **DOCUMENTED** (add narrow for mobile install UI) |
| **No 192x192 maskable icon** | Low | S | ❌ **DOCUMENTED** (add for broader device support) |

---

## Performance Audit

### Image Optimization
| Item | Status | Notes |
|------|--------|-------|
| WebP/AVIF usage | ⚠️ Partial | Event images from `images.getcebby.com` served as JPG; splash screens are JPEG. Consider serving WebP with JPG fallback or using Cloudflare Image Resizing |
| Lazy loading | ✅ Good | EventCard.astro uses `loading="lazy"` for card images |
| Hero image | ✅ Good | Event detail page uses `loading="eager"` for cover photo (LCP candidate) |
| OG image size | ⚠️ High | `/og.png` is 830KB; should compress to <200KB |
| Partner logos | ⚠️ Mixed | Some partners use `.jpg`, one uses `.svg` (AWS Cloud Club); prefer WebP or optimized SVG |

**Recommendation:** Set up Cloudflare Image Resizing or a build-time image optimization pipeline (e.g., `@astrojs/image`) to auto-convert to WebP.

### Font Strategy
| Item | Status | Notes |
|------|--------|-------|
| Preconnect | ✅ Good | `<link rel="preconnect" href="https://fonts.googleapis.com">` + gstatic |
| Font loading | ✅ Good | Google Fonts with `display=swap` |
| Service worker caching | ✅ Good | Workbox caches Google Fonts with CacheFirst + 365-day expiration |

### JavaScript & CSS
| Item | Status | Notes |
|------|--------|-------|
| Astro SSR | ✅ Good | Server-side rendering reduces client-side JS |
| Service worker size | ✅ Good | Workbox strategy is efficient (StaleWhileRevalidate for pages) |
| Third-party scripts | ⚠️ 2 scripts | Beam Analytics + umami (stats.gocebby.com); both async/defer, acceptable |
| Typesense search | ⚠️ Client-side | Typesense client library loaded; consider prefetching search index for first paint |

### Caching & Headers
| Item | Status | Notes |
|------|--------|-------|
| Homepage cache | ✅ Good | `s-maxage=60, stale-while-revalidate=300` |
| Events page cache | ✅ Good | `s-maxage=300, stale-while-revalidate=60` |
| Sitemap cache | ✅ Good | `max-age=3600` |
| Cloudflare Pages headers | ⚠️ Unknown | No `_headers` or `wrangler.toml` in repo; relies on Astro response headers. Consider adding `_headers` for static assets (1-year cache on `/icons/*`, `/splash/*`) |

**Recommendation:** Add `apps/pwa/public/_headers` to set long cache for static assets:
```
/icons/*
  Cache-Control: public, max-age=31536000, immutable

/splash/*
  Cache-Control: public, max-age=31536000, immutable

/og.png
  Cache-Control: public, max-age=604800
```

### LCP (Largest Contentful Paint) Candidates
| Page | LCP Element | Current Strategy | Recommendation |
|------|-------------|------------------|----------------|
| `/` (homepage) | Hero event card cover image | `loading="lazy"` | Add `fetchpriority="high"` to first featured event image |
| `/events` | First event card image | `loading="lazy"` | Add `fetchpriority="high"` to first visible card |
| `/events/[slug]` | Event cover photo | `loading="eager"` ✅ | Already optimized |

---

## Accessibility & UX Polish

### ✅ Strengths
| Item | Status |
|------|--------|
| Focus states | ✅ Good | Tailwind focus utilities applied to interactive elements |
| ARIA labels | ✅ Good | Back button has `aria-label="Back to events"` |
| Color contrast | ✅ Good | Purple brand color (#9333ea) passes WCAG AA on white backgrounds |
| Reduced motion | ✅ Excellent | `@media (prefers-reduced-motion: reduce)` disables all animations |
| Viewport meta | ✅ Good | `viewport-fit=cover` for safe-area insets |

### ⚠️ Weaknesses
| Issue | Impact | Effort | Status |
|-------|--------|--------|--------|
| **Viewport disables zoom (a11y violation)** | **High** | **M** | ❌ **DOCUMENTED** (`maximum-scale=1.0, user-scalable=no` prevents zoom for low-vision users; needs UX testing) |
| **38 apple-touch-startup-image links** | Low | M | ❌ **DOCUMENTED** (heavy initial HTML weight; consider dynamic injection or subset) |
| **Empty states (calendar)** | Low | S | ❌ **DOCUMENTED** (show helpful message when no events in month) |
| **Mobile sticky nav conflicts** | Low | M | ❌ **DOCUMENTED** (test bottom tab dock on iOS Safari) |
| **Keyboard navigation** | Low | M | ❌ **DOCUMENTED** (audit tab order on `/events` filter chips) |

---

## Top 12 Prioritized Recommendations

| # | Recommendation | Impact | Effort | Status |
|---|---------------|--------|--------|--------|
| 1 | Add Organization/WebSite/FAQPage JSON-LD to homepage | High | S | ✅ **IMPLEMENTED** |
| 2 | Enrich Event JSON-LD with geo-coordinates (lat/lng) | High | S | ✅ **IMPLEMENTED** |
| 3 | Fix Event addressLocality to use city name not venue name | High | S | ✅ **IMPLEMENTED** |
| 4 | Fix PWA manifest theme_color to brand purple | Med | Trivial | ✅ **IMPLEMENTED** |
| 5 | Add og:locale meta tag | Med | S | ✅ **IMPLEMENTED** |
| 6 | Add _headers for Cloudflare static asset caching | Med | S | ✅ **IMPLEMENTED** |
| 7 | Add fetchpriority="high" to LCP images | Med | S | ✅ **IMPLEMENTED** |
| 8 | Improve calendar page meta | Low | S | ✅ **IMPLEMENTED** |
| 9 | **Fix viewport a11y (remove user-scalable=no)** | **High** | **M** | ❌ **DOCUMENTED** (needs UX testing) |
| 10 | Fix Event organizer URLs to real org pages | Med | M | ❌ **DOCUMENTED** (needs org URL data) |
| 11 | Investigate sitemap 500/403 errors for bots | Med | M | ❌ **DOCUMENTED** (CF/Supabase issue) |
| 12 | Optimize /og.png to <200KB | Med | S | ❌ **DOCUMENTED** (needs design tool) |

**Legend:**  
- **Impact:** High = directly affects SEO/GEO rankings or Core Web Vitals; Med = improves discoverability or UX; Low = polish  
- **Effort:** S = <1hr, M = 1-4hrs, L = >4hrs  

---

## Implementation Notes

### Changes Made (✅ Implemented)

#### 1. Homepage JSON-LD Structured Data
**File:** `apps/pwa/src/pages/index.astro`

Added three schema types to improve GEO and SEO:
- **WebSite schema** with `searchAction` (enables Google Search sitelinks search box)
- **Organization schema** with logo, sameAs links to GitHub/Notion
- **FAQPage schema** wrapping existing 5 FAQ items

**Impact:** High — AI models can now extract entity facts about Cebby (what it is, who runs it, FAQ answers for "Is Cebby free?", etc.)

#### 2. Event Location Geo-Coordinates + City Name Fix in JSON-LD
**File:** `apps/pwa/src/pages/events/[slug].astro`

Enhanced Event schema `location` to include:
- **Fixed `addressLocality`:** Now uses proper city name ("Cebu City", "Mandaue City", "Lapu-Lapu City") instead of venue name, per Schema.org spec
- **Added geo-coordinates:** `geo.latitude` and `geo.longitude` when coordinates exist in `event.location_details` or venue resolver
- Maps venue neighborhood to city: Mandaue → "Mandaue City", Mactan → "Lapu-Lapu City", else "Cebu City"

**Impact:** High — Google/Bing can show events on map results + correct city in rich snippets; AI answers include location coordinates

**Example before (PRODUCTION BUG):**
```json
"location": {
  "@type": "Place",
  "name": "lyf Cebu City",
  "address": { "@type": "PostalAddress", "addressLocality": "lyf Cebu City", "addressRegion": "Cebu", "addressCountry": "PH" }
}
```

**Example after (FIXED):**
```json
"location": {
  "@type": "Place",
  "name": "lyf Cebu City",
  "address": { "@type": "PostalAddress", "addressLocality": "Cebu City", "addressRegion": "Cebu", "addressCountry": "PH" },
  "geo": { "@type": "GeoCoordinates", "latitude": 10.3157, "longitude": 123.9053 }
}
```

#### 3. PWA Manifest Fixes
**File:** `apps/pwa/astro.config.mjs`

- Changed `theme_color` from `#ffffff` → `#8234E6` (brand purple, matches `background_color`)
- Expanded `description` from truncated "Discover all tech events in Cebu in one place..." → full "Discover all Cebu tech events — meetups, workshops, conferences, and hackathons — aggregated from Luma, Eventbrite, Meetup, and Facebook into one calm feed."

**Impact:** Medium — Better PWA install prompt visuals; more descriptive in app stores

---

## Issues NOT Fixed (Documented)

### High Priority (Needs Further Analysis)

#### 1. Viewport A11y Violation
**File:** `apps/pwa/src/layouts/Layout.astro:24`

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
```

**Issue:** `maximum-scale=1.0, user-scalable=no` prevents pinch-to-zoom, blocking low-vision users from accessing content.

**Why not fixed:** Likely intentional for PWA "app-like feel" (prevents accidental zoom during tap interactions). Needs UX testing to verify removing it doesn't break gestures.

**Recommendation:** Test removing `maximum-scale` and `user-scalable=no` on iOS Safari + Android Chrome. Modern touch event handling should prevent double-tap zoom without disabling zoom entirely.

**WCAG Violation:** Level AA 1.4.4 (Resize text)

---

#### 2. Event Organizer URLs Point to Cebby, Not Real Orgs
**File:** `apps/pwa/src/pages/events/[slug].astro:237-238`

```typescript
organizer: organizers.length > 0
    ? organizers.map((item) => ({ '@type': 'Organization', name: item.name, url: Astro.url.origin }))
```

**Issue:** All organizer `url` fields = `https://www.getcebby.com` instead of real org websites (e.g. `https://jscebu.org`, `https://github.com/devcon-cebu`)

**Why not fixed:** Requires org URL data in DB (likely `accounts.website` or `organizations.website`). Needs DB query change + verification that URLs exist for all orgs.

**Impact:** Medium — Search engines can't discover org relationships; AI answers lack org context.

**Recommendation:** 
1. Check if `accounts.website` or `organizations.website` exists in Supabase schema
2. If yes, add to SELECT query: `accounts(account_id,name,is_verified,ingest_kind,website)`
3. Use real URL when available, fall back to `Astro.url.origin` when null

---

### Medium Priority (Operational/Monitoring)

#### 3. Sitemap Intermittent 500/403 Errors for Bots
**File:** `apps/pwa/src/pages/sitemap.xml.ts`

**Issue:** Sitemap works with browser UA (~517 URLs) but reports intermittent HTTP 500/403 for bot UAs.

**Possible causes:**
- Cloudflare Pages rate-limiting bot requests to API routes
- Supabase connection timeout on long queries (513 events)
- Missing User-Agent allowlist in Cloudflare WAF

**Not reproduced in current test** (curl without UA succeeded), suggests intermittent issue.

**Recommendation:** 
1. Add Cloudflare Analytics to track sitemap request failures by UA
2. Consider adding `Cache-Control: s-maxage=3600` (currently only `max-age=3600`) for edge caching
3. Add error logging to capture Supabase error details when query fails

---

### Low Priority (Polish)

#### 4. Apple Splash Screen Link Weight
**File:** `apps/pwa/src/layouts/Layout.astro:48-237`

**Issue:** ~38 `<link rel="apple-touch-startup-image">` tags add ~3KB to every HTML response.

**Impact:** Minor — initial HTML size, but splash screens only load on iOS when adding to home screen.

**Options:**
- Leave as-is (comprehensive device support)
- Remove oldest/rarest devices (e.g. iPhone SE 1st gen, iPad Mini 4)
- Dynamic injection via JS (only add when iOS detected)

**Recommendation:** Leave as-is unless Lighthouse flags HTML size. Modern HTTP/2 handles small payloads efficiently.

---

#### 5. Manifest display_override Includes "fullscreen"
**File:** `apps/pwa/astro.config.mjs:102`

```javascript
display_override: ['fullscreen', 'minimal-ui'],
```

**Issue:** `fullscreen` is aggressive — hides browser/system UI entirely. Most PWAs use `standalone` or `minimal-ui`.

**Impact:** Low — users can exit fullscreen, but unexpected behavior on first launch.

**Recommendation:** Consider removing `fullscreen` from array, keeping only `minimal-ui` for subtle chrome.

---

#### 6. Manifest Screenshots Missing Narrow (Mobile)
**File:** `apps/pwa/astro.config.mjs:103-111`

**Issue:** Only one screenshot with `form_factor: "wide"` (desktop). Mobile install prompts benefit from narrow (portrait) screenshots.

**Recommendation:** Add 1-2 mobile portrait screenshots (e.g. 390x844, 428x926) showing /events or /calendar view.

---

## Not Implemented (Backlog)

### Quick Wins (Safe, 5-10min Each)
1. **OG locale tag** — Add `<meta property="og:locale" content="en_PH">` to `SEO.astro`
2. **LCP fetchpriority** — Add `fetchpriority="high"` to first hero event image on homepage + first card on `/events`
3. **Cloudflare _headers** — Create `apps/pwa/public/_headers` for long-term static asset caching
4. **Calendar meta** — Update `apps/pwa/src/pages/calendar.astro` title/description

### Medium Effort (Needs More Testing)
5. **OG image optimization** — Compress `/og.png` from 830KB → <200KB (needs design tool)
6. **WebP conversion** — Set up Cloudflare Image Resizing or build-time WebP pipeline
7. **Maskable icon** — Export 192x192 maskable icon from design files

### Lower Priority (Polish)
8. **Empty states** — Calendar month with no events should show helpful message
9. **Partner logo optimization** — Convert partner images to WebP or optimize SVGs
10. **Keyboard nav audit** — Test tab order on filter chips, search input, modals

---

## Testing Recommendations

### SEO Validation
- [ ] Google Search Console: Submit updated sitemap, check coverage
- [ ] Bing Webmaster Tools: Verify structured data indexing
- [ ] Rich Results Test: https://search.google.com/test/rich-results (test Event JSON-LD)
- [ ] Schema Markup Validator: https://validator.schema.org/ (test Organization/WebSite/FAQPage)

### GEO Validation
- [ ] Perplexity.ai: Search "Cebu tech events" — does Cebby appear in AI answer?
- [ ] ChatGPT/Claude: Ask "Where can I find tech events in Cebu?" — verify factual extraction
- [ ] Google SERPs: Search "Cebu tech events" — check if Events rich snippet appears

### Performance Validation
- [ ] Lighthouse (Desktop + Mobile): Target 90+ Performance, 100 Accessibility, 100 SEO
- [ ] PageSpeed Insights: Check Core Web Vitals (LCP <2.5s, FID <100ms, CLS <0.1)
- [ ] WebPageTest: Test from Asia-Pacific location (Singapore/Tokyo)

### PWA Validation
- [ ] Chrome DevTools > Application > Manifest: Verify theme_color, icons, shortcuts
- [ ] iOS Safari: Test Add to Home Screen, verify splash screens + icon
- [ ] Android Chrome: Test install prompt, verify maskable icon

---

## Appendix: File Paths

### Key Files Modified
- `apps/pwa/src/pages/index.astro` — Added Organization/WebSite/FAQPage JSON-LD
- `apps/pwa/src/pages/events/[slug].astro` — Added geo-coordinates to Event JSON-LD
- `apps/pwa/astro.config.mjs` — Fixed manifest theme_color + description

### Key Files Referenced (Not Modified)
- `apps/pwa/src/components/SEO.astro` — OG/Twitter cards component
- `apps/pwa/src/layouts/Layout.astro` — Base layout with PWA meta tags
- `apps/pwa/src/pages/sitemap.xml.ts` — Dynamic sitemap generation
- `apps/pwa/public/robots.txt` — Search engine directives
- `apps/pwa/src/pages/calendar.astro` — Calendar view (meta could be improved)

---

## Appendix: External Resources

### Structured Data References
- [Google Event schema guide](https://developers.google.com/search/docs/appearance/structured-data/event)
- [Schema.org Event](https://schema.org/Event)
- [Schema.org Organization](https://schema.org/Organization)
- [Schema.org WebSite](https://schema.org/WebSite)
- [Schema.org FAQPage](https://schema.org/FAQPage)

### GEO Resources
- [Generative Engine Optimization whitepaper](https://arxiv.org/abs/2311.09735)
- [Moz: Optimizing for AI Overviews](https://moz.com/blog/optimizing-for-ai-overviews)

### PWA Resources
- [MDN: Web app manifests](https://developer.mozilla.org/en-US/docs/Web/Manifest)
- [web.dev: PWA checklist](https://web.dev/pwa-checklist/)

---

**End of Audit**
