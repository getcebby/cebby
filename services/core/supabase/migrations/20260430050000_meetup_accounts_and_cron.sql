-- ============================================================================
-- Meetup ingest — accounts seed + cron schedule
-- ============================================================================
--
-- Replaces the n8n workflow that backfilled v1.5 staging from a hardcoded list
-- of 15 Cebu tech Meetup groups. Same group list, same 6h cadence, but now:
--   • Group urlnames live in `accounts` rows, not in JS embedded in n8n
--   • The cron's pg_cron + pg_net fan-out matches Luma/Facebook
--   • Per-event ingest goes through `ingestEvents()` so multi-source matching
--     and source priority work correctly (e.g. a Meetup event also posted on
--     Facebook for the same community attaches as a second event_source_link)
--
-- The 15 groups below are vetted Cebu-area communities. Adding more is an
-- INSERT into accounts; no code change needed.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Seed the 15 Meetup group accounts
-- ----------------------------------------------------------------------------

INSERT INTO "public"."accounts" (account_id, name, type, kind, discovery_path, is_active, ingest_kind)
VALUES
    ('aws-cloud-club-at-cebu-technological-university',          'AWS Cloud Club at Cebu Technological University',          'meetup', 'meetup_group', 'aws-cloud-club-at-cebu-technological-university',          true, 'public_scrape'),
    ('aws-cloud-club-at-university-of-the-philippines-cebu',     'AWS Cloud Club at University of the Philippines Cebu',     'meetup', 'meetup_group', 'aws-cloud-club-at-university-of-the-philippines-cebu',     true, 'public_scrape'),
    ('aws-cloud-club-at-southwestern-university-phinma',         'AWS Cloud Club at Southwestern University PHINMA',         'meetup', 'meetup_group', 'aws-cloud-club-at-southwestern-university-phinma',         true, 'public_scrape'),
    ('aws-cloud-club-at-cebu-institute-of-technology-university','AWS Cloud Club at Cebu Institute of Technology University','meetup', 'meetup_group', 'aws-cloud-club-at-cebu-institute-of-technology-university',true, 'public_scrape'),
    ('aws-cloud-club-at-cebu-eastern-college',                   'AWS Cloud Club at Cebu Eastern College',                   'meetup', 'meetup_group', 'aws-cloud-club-at-cebu-eastern-college',                   true, 'public_scrape'),
    ('aws-cloud-club-at-university-of-cebu',                     'AWS Cloud Club at University of Cebu',                     'meetup', 'meetup_group', 'aws-cloud-club-at-university-of-cebu',                     true, 'public_scrape'),
    ('pizzapy-ph',                                               'PizzaPy PH',                                               'meetup', 'meetup_group', 'pizzapy-ph',                                               true, 'public_scrape'),
    ('javascript-cebu',                                          'JavaScript Cebu',                                          'meetup', 'meetup_group', 'javascript-cebu',                                          true, 'public_scrape'),
    ('official-unity-user-group-sea',                            'Unity User Group SEA',                                     'meetup', 'meetup_group', 'official-unity-user-group-sea',                            true, 'public_scrape'),
    ('agentcon-cebu',                                            'AgentCon Cebu',                                            'meetup', 'meetup_group', 'agentcon-cebu',                                            true, 'public_scrape'),
    ('aws-usergroup-ph-central-visayas',                         'AWS User Group PH Central Visayas',                        'meetup', 'meetup_group', 'aws-usergroup-ph-central-visayas',                         true, 'public_scrape'),
    ('wordpresscebu',                                            'WordPress Cebu',                                           'meetup', 'meetup_group', 'wordpresscebu',                                            true, 'public_scrape'),
    ('cebu-javascript-meetup',                                   'Cebu JavaScript Meetup',                                   'meetup', 'meetup_group', 'cebu-javascript-meetup',                                   true, 'public_scrape'),
    ('cebu-r-users-group-crug',                                  'Cebu R Users Group (CRUG)',                                'meetup', 'meetup_group', 'cebu-r-users-group-crug',                                  true, 'public_scrape'),
    ('golang-cebu',                                              'Golang Cebu',                                              'meetup', 'meetup_group', 'golang-cebu',                                              true, 'public_scrape')
ON CONFLICT ("account_id") DO NOTHING;


-- ----------------------------------------------------------------------------
-- 2. Mark these as verified partners (matches Luma/FB pattern: any account
--    we hand-curate into a discovery seed is also a vetted whitelist entry).
-- ----------------------------------------------------------------------------

UPDATE "public"."accounts"
   SET "is_verified" = true
 WHERE "type" = 'meetup'
   AND "kind" = 'meetup_group'
   AND "is_verified" = false
   AND "discovery_path" IS NOT NULL;


-- ----------------------------------------------------------------------------
-- 3. Schedule the cron — every 6h, offset 15 min from luma (00:00) and
--    fb (00:30), so the three syncs don't all spike egress at the same minute.
-- ----------------------------------------------------------------------------

SELECT cron.schedule(
    'sync-meetup-accounts',
    '15 */6 * * *',
    $cron$
    SELECT public.fan_out_account_syncs(
        'meetup',
        'https://enwcrupzidbcwimyttla.supabase.co/functions/v1/retrieve-and-sync-to-db-meetup-events'
    );
    $cron$
);


-- ============================================================================
-- End of meetup ingest setup.
--
-- Followups:
--   • The 8 stranded meetup events (no event_organizers) heal automatically
--     on the next cron cycle: ingestEvents matches by (source, source_id),
--     hits the rescrape branch, and writeOrganizers attaches the new account.
--   • To trigger a sync immediately without waiting for the schedule:
--       SELECT public.fan_out_account_syncs(
--           'meetup',
--           'https://enwcrupzidbcwimyttla.supabase.co/functions/v1/retrieve-and-sync-to-db-meetup-events'
--       );
-- ============================================================================
