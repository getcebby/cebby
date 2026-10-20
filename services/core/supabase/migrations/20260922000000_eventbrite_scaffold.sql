-- ============================================================================
-- Eventbrite ingest scaffold
-- ============================================================================
--
-- Unparks the platform without enabling production fan-out yet.
-- Account shape (when seeded later):
--   type = 'eventbrite'
--   kind = 'eventbrite_organizer'
--   discovery_path = organizer vanity / org slug
--   ingest_kind = 'public_scrape'  (or public_api once we have keys)
--
-- DEFAULT_SOURCE_PRIORITY in services/core already includes 'eventbrite'.
-- Schema comments already reserve kind=eventbrite_organizer.
--
-- TODO before uncommenting cron:
--   1. Deploy eventbrite-scraper + retrieve-and-sync-to-db-eventbrite-events
--   2. Implement HTML/API scrape in services/eventbrite
--   3. Seed vetted Cebu tech organizers into accounts
-- ============================================================================

-- Optional health-bucket documentation row (no-op insert if table is append-only).
-- service_health_events.bucket is free-text; 'eventbrite' is the reserved name.

-- SELECT cron.schedule(
--     'sync-eventbrite-accounts',
--     '45 */6 * * *',  -- offset from luma :00, meetup :15, fb :30
--     $cron$
--     SELECT public.fan_out_account_syncs(
--         'eventbrite',
--         'https://enwcrupzidbcwimyttla.supabase.co/functions/v1/retrieve-and-sync-to-db-eventbrite-events'
--     );
--     $cron$
-- );

COMMENT ON COLUMN public.accounts.kind IS
  'Platform-presence kind: fb_page | luma_calendar | luma_user | meetup_group | eventbrite_organizer | website_organizer | unknown';
