# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a PWA (Progressive Web App) built with Astro for discovering tech events in Cebu. The app is deployed on Cloudflare Pages and integrates with Supabase for data storage.

## Development Commands

- `npm run dev` - Start development server at localhost:4321
- `npm run build` - Build for production (includes Astro check for TypeScript errors)
- `npm run preview` - Build and preview with Wrangler Pages locally
- `npm run deploy` - Build and deploy to Cloudflare Pages
- `npm run astro` - Run Astro CLI commands
- `npm run cf-typegen` - Generate Cloudflare Workers types
- `npm run pwa-assets` - Generate PWA splash screens and icons

## Architecture

### Tech Stack
- **Framework**: Astro 5.x with SSR mode
- **Deployment**: Cloudflare Pages with adapter
- **Database**: Supabase (PostgreSQL)
- **Styling**: Tailwind CSS
- **PWA**: @vite-pwa/astro with Workbox service worker
- **TypeScript**: Full TypeScript support

### Key Dependencies
- `@supabase/supabase-js` - Supabase client
- `@service/core` - Workspace package containing shared Supabase types
- `date-fns` and `date-fns-tz` - Date manipulation
- `ical-generator` - Calendar file generation
- `workbox-window` - PWA functionality

### Workspace Structure
This is part of a monorepo using workspace packages:
- `@service/core` - Shared core services and types
- `@repo/eslint-config` - Shared ESLint configuration

### Data Layer
- **Supabase Client**: Configured in `src/lib/supabase.ts`
- **Database Types**: Imported from `@service/core/supabase/shared/database.types.ts`
- **Event Types**: Defined in `src/types/database.ts` with interfaces like `EventFromDB`, `AccountsFromDB`
- **API Routes**: Located in `src/pages/api/` for calendar exports, search, feedback

### PWA Configuration
- **Service Worker**: Auto-generated with Workbox
- **Manifest**: Configured in `astro.config.mjs` with shortcuts, screenshots, protocol handlers
- **Caching**: StaleWhileRevalidate for pages, CacheFirst for fonts, runtime caching for images
- **Update Mechanism**: ReloadPrompt component for user-controlled updates

### Page Structure
- **Homepage**: `/` - Main landing page
- **Events**: `/events` - Event listing with filtering
- **Event Details**: `/events/[slug]` - Individual event pages
- **Calendar**: `/calendar` - Calendar view of events
- **Saved Events**: `/saved` - User's saved events
- **Search**: `/search` - Event search functionality
- **Partners**: `/partners` - Partner organizations

### Component Architecture
Components are primarily Astro components (.astro files):
- Event-related: EventCard, EventMap, EventSkeleton, RelatedEvents
- User interaction: RsvpButton, SaveEventButton, FeedbackForm
- Navigation: Header, Navigation, Search
- PWA features: InstallPrompt, ReloadPrompt, UpdatePrompt, OfflineIndicator

### Styling Approach
- **Tailwind CSS**: Utility-first styling
- **Safe Area**: Custom CSS properties for mobile safe areas (`--sat`, `--sar`, etc.)
- **Responsive Design**: Mobile-first PWA optimized for iOS and Android
- **Loading States**: Global loading bar with Astro navigation events

### Environment Configuration
- Uses Cloudflare Pages environment variables
- Supabase URL and anon key configured via `PUBLIC_SUPABASE_URL` and `PUBLIC_SUPABASE_ANON_KEY`
- Build date injection via Vite define

### Browser Compatibility
- Node.js polyfills for browser compatibility (crypto, stream, events, etc.)
- Configured in Vite resolve.alias for edge runtime compatibility

## Important Implementation Notes

1. **PWA Version Management**: The app uses separate `APP_VERSION` and `CACHE_VERSION` for different update types
2. **Prefetching**: Critical pages (/events, /calendar, /saved) are prefetched on load
3. **Service Worker Strategy**: Uses 'prompt' registration type, not auto-update
4. **Image Optimization**: Cloudflare image service integration
5. **Analytics**: Beam Analytics and custom analytics in production
6. **Offline Support**: Comprehensive caching with offline fallback page