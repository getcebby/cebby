-- Status rules behind https://www.getcebby.com/status (private.scraper_status_at).
-- Every check is evaluated at a fixed "now" of 2026-11-03 12:00 UTC.
BEGIN;
SELECT plan(66);

-- The bootstrap migrations seed a few rows; start from nothing.
DELETE FROM public.service_health_events;

CREATE FUNCTION pg_temp.status_at(p_now timestamptz, p_source text, p_line text)
RETURNS TABLE(state text, since timestamptz, last_worked_at timestamptz, last_checked_at timestamptz,
              noticed_at timestamptz)
LANGUAGE sql AS $$
    SELECT state, since, last_worked_at, last_checked_at, noticed_at
    FROM private.scraper_status_at(p_now)
    WHERE source = p_source AND line = p_line
$$;

CREATE FUNCTION pg_temp.status(p_source text, p_line text)
RETURNS TABLE(state text, since timestamptz, last_worked_at timestamptz, last_checked_at timestamptz,
              noticed_at timestamptz)
LANGUAGE sql AS $$
    SELECT * FROM pg_temp.status_at('2026-11-03 12:00+00', p_source, p_line)
$$;

-- One link-check result: status is success (pass), error (fail) or warning (no test event).
CREATE FUNCTION pg_temp.link(p_bucket text, p_status text, p_at timestamptz)
RETURNS void LANGUAGE sql AS $$
    INSERT INTO public.service_health_events (bucket, source, status, fingerprint, metadata, occurred_at)
    VALUES (p_bucket, 'link-check', p_status, 'test', '{"line":"link","attempts":[]}', p_at)
$$;

-- One cron account run that did (or didn't) read its listing page.
CREATE FUNCTION pg_temp.finding(p_bucket text, p_line text, p_read boolean, p_at timestamptz)
RETURNS void LANGUAGE sql AS $$
    INSERT INTO public.service_health_events (bucket, source, status, fingerprint, metadata, occurred_at)
    VALUES (p_bucket, 'retrieve-and-sync', 'success', 'account_processed',
            jsonb_build_object('ingested', 0, 'line', p_line, 'page_read', p_read), p_at)
$$;

-- 1. A single failed link check after a pass is a blip: still working.
SELECT pg_temp.link('meetup', 'success', '2026-11-03 10:40+00');
SELECT pg_temp.link('meetup', 'error', '2026-11-03 11:40+00');
SELECT is((SELECT state FROM pg_temp.status('meetup', 'link')), 'working', 'one failed link check stays working');
SELECT is((SELECT last_worked_at FROM pg_temp.status('meetup', 'link')), '2026-11-03 10:40+00'::timestamptz,
    'last_worked_at is the latest pass');
SELECT is((SELECT last_checked_at FROM pg_temp.status('meetup', 'link')), '2026-11-03 11:40+00'::timestamptz,
    'last_checked_at is the latest result');
SELECT is((SELECT since FROM pg_temp.status('meetup', 'link')), NULL::timestamptz, 'working has no since');
SELECT is((SELECT noticed_at FROM pg_temp.status('meetup', 'link')), NULL::timestamptz, 'working has no noticed_at');

-- 2. Two failed link checks in a row: broken since the first of them.
DELETE FROM public.service_health_events;
SELECT pg_temp.link('meetup', 'success', '2026-11-03 09:40+00');
SELECT pg_temp.link('meetup', 'error', '2026-11-03 10:40+00');
SELECT pg_temp.link('meetup', 'error', '2026-11-03 11:40+00');
SELECT is((SELECT state FROM pg_temp.status('meetup', 'link')), 'broken', 'two failed link checks are broken');
SELECT is((SELECT since FROM pg_temp.status('meetup', 'link')), '2026-11-03 10:40+00'::timestamptz,
    'broken since the first failure of the current run');
SELECT is((SELECT last_worked_at FROM pg_temp.status('meetup', 'link')), '2026-11-03 09:40+00'::timestamptz,
    'broken keeps the last time it worked');
SELECT is((SELECT noticed_at FROM pg_temp.status('meetup', 'link')), '2026-11-03 11:40+00'::timestamptz,
    'broken is noticed at the second failure, when the line turned broken');

-- 3. A link line whose latest result is over 3 hours old is not checked recently.
SELECT pg_temp.link('luma', 'success', '2026-11-03 08:00+00');
SELECT is((SELECT state FROM pg_temp.status('luma', 'link')), 'not_checked', 'a 4h-old link result is stale');
SELECT is((SELECT since FROM pg_temp.status('luma', 'link')), '2026-11-03 11:00+00'::timestamptz,
    'stale since the result passed the 3h limit');
SELECT is((SELECT last_worked_at FROM pg_temp.status('luma', 'link')), '2026-11-03 08:00+00'::timestamptz,
    'stale keeps the last time it worked');
SELECT is((SELECT noticed_at FROM pg_temp.status('luma', 'link')), '2026-11-03 11:00+00'::timestamptz,
    'stale is noticed when it went stale');

-- 4. Link checks with no usable test event.
SELECT pg_temp.link('facebook', 'warning', '2026-11-03 10:40+00');
SELECT pg_temp.link('facebook', 'warning', '2026-11-03 11:40+00');
SELECT is((SELECT state FROM pg_temp.status('facebook', 'link')), 'no_test_event', 'no sample is no_test_event');
SELECT is((SELECT since FROM pg_temp.status('facebook', 'link')), '2026-11-03 10:40+00'::timestamptz,
    'no_test_event since the first of the current run');
SELECT is((SELECT noticed_at FROM pg_temp.status('facebook', 'link')), '2026-11-03 10:40+00'::timestamptz,
    'no_test_event is noticed at once');

-- 5. A link line with no results at all.
SELECT is((SELECT state FROM pg_temp.status('eventbrite', 'link')), 'not_checked', 'no results is not_checked');
SELECT is((SELECT since FROM pg_temp.status('eventbrite', 'link')), NULL::timestamptz,
    'never checked has no since');

-- 12. A result older than the 7-day lookback is ignored.
SELECT pg_temp.link('eventbrite', 'success', '2026-10-26 12:00+00');
SELECT is((SELECT state FROM pg_temp.status('eventbrite', 'link')), 'not_checked', 'an 8-day-old result is ignored');
SELECT is((SELECT since FROM pg_temp.status('eventbrite', 'link')), NULL::timestamptz,
    'an ignored result sets no since');
SELECT is((SELECT last_worked_at FROM pg_temp.status('eventbrite', 'link')), NULL::timestamptz,
    'an ignored result sets no last_worked_at');

-- 6. Finding windows: every page read is a pass, fewer than half read a failure, and
-- anything between partial (20261104020000).
SELECT pg_temp.finding('luma', 'finding', false, '2026-11-03 00:01+00');
SELECT pg_temp.finding('luma', 'finding', false, '2026-11-03 00:02+00');
SELECT pg_temp.finding('luma', 'finding', false, '2026-11-03 00:03+00');
SELECT pg_temp.finding('luma', 'finding', true, '2026-11-03 06:01+00');
SELECT pg_temp.finding('luma', 'finding', true, '2026-11-03 06:02+00');
SELECT pg_temp.finding('luma', 'finding', false, '2026-11-03 06:03+00');
SELECT is((SELECT state FROM pg_temp.status('luma', 'finding')), 'degraded',
    '2 of 3 pages read is partial, and after a failed window that is degraded');
SELECT is((SELECT last_worked_at FROM pg_temp.status('luma', 'finding')), NULL::timestamptz,
    'no window had every page read, so it never fully worked');
SELECT is((SELECT last_checked_at FROM pg_temp.status('luma', 'finding')), '2026-11-03 06:03+00'::timestamptz,
    'last_checked_at is the latest window');

-- 7. Two failed windows in a row: broken since the older window.
SELECT pg_temp.finding('facebook', 'watched_pages', false, '2026-11-03 00:31+00');
SELECT pg_temp.finding('facebook', 'watched_pages', false, '2026-11-03 00:32+00');
SELECT pg_temp.finding('facebook', 'watched_pages', false, '2026-11-03 06:31+00');
SELECT pg_temp.finding('facebook', 'watched_pages', false, '2026-11-03 06:32+00');
SELECT is((SELECT state FROM pg_temp.status('facebook', 'watched_pages')), 'broken', 'two failed windows are broken');
SELECT is((SELECT since FROM pg_temp.status('facebook', 'watched_pages')), '2026-11-03 00:32+00'::timestamptz,
    'broken since the older failed window');
SELECT is((SELECT last_worked_at FROM pg_temp.status('facebook', 'watched_pages')), NULL::timestamptz,
    'never worked has no last_worked_at');
SELECT is((SELECT noticed_at FROM pg_temp.status('facebook', 'watched_pages')), '2026-11-03 07:00+00'::timestamptz,
    'a broken finding line is noticed when its second failed window first shows, an hour after it opens');

-- 8. Exactly half the pages read is not a failure, but not a pass either.
SELECT pg_temp.finding('meetup', 'finding', true, '2026-11-03 06:16+00');
SELECT pg_temp.finding('meetup', 'finding', true, '2026-11-03 06:17+00');
SELECT pg_temp.finding('meetup', 'finding', false, '2026-11-03 06:18+00');
SELECT pg_temp.finding('meetup', 'finding', false, '2026-11-03 06:19+00');
SELECT is((SELECT state FROM pg_temp.status('meetup', 'finding')), 'unconfirmed',
    'exactly half the pages read is a lone partial window: unconfirmed');

-- 9. Rows without page_read (skipped accounts, old rows) are ignored.
INSERT INTO public.service_health_events (bucket, source, status, fingerprint, metadata, occurred_at)
VALUES ('facebook', 'retrieve-and-sync-to-db-events', 'warning', 'account_skipped', '{"ingested":0}',
        '2026-11-03 06:31+00');
SELECT is((SELECT state FROM pg_temp.status('facebook', 'partner_pages')), 'not_checked',
    'rows without page_read produce no result');
SELECT is((SELECT since FROM pg_temp.status('facebook', 'partner_pages')), NULL::timestamptz,
    'ignored rows set no since');

-- Link rows never count toward finding lines, nor finding rows toward link lines.
SELECT is((SELECT last_checked_at FROM pg_temp.status('facebook', 'link')), '2026-11-03 11:40+00'::timestamptz,
    'finding rows do not count as link results');

-- 10. A finding line whose latest window is over 13 hours old is not checked recently.
SELECT pg_temp.finding('facebook', 'partner_pages', true, '2026-11-02 21:45+00');
SELECT is((SELECT state FROM pg_temp.status('facebook', 'partner_pages')), 'not_checked',
    'a 14h-old finding window is stale');
SELECT is((SELECT since FROM pg_temp.status('facebook', 'partner_pages')), '2026-11-03 10:45+00'::timestamptz,
    'stale since the window passed the 13h limit');

-- 11. Eventbrite finding is not set up, whatever rows exist.
SELECT pg_temp.finding('eventbrite', 'finding', true, '2026-11-03 06:00+00');
SELECT is((SELECT state FROM pg_temp.status('eventbrite', 'finding')), 'not_set_up', 'eventbrite finding is not set up');
SELECT is((SELECT last_checked_at FROM pg_temp.status('eventbrite', 'finding')), NULL::timestamptz,
    'not set up has no last_checked_at');

-- 13. A first failure with nothing before it is unconfirmed: never green, not yet broken,
-- and not "not checked" either (it was checked: it failed).
DELETE FROM public.service_health_events WHERE bucket = 'eventbrite' AND source = 'link-check';
SELECT pg_temp.link('eventbrite', 'error', '2026-11-03 11:40+00');
SELECT is((SELECT state FROM pg_temp.status('eventbrite', 'link')), 'unconfirmed',
    'a lone first failure is unconfirmed, not working and not "not checked"');
SELECT is((SELECT since FROM pg_temp.status('eventbrite', 'link')), '2026-11-03 11:40+00'::timestamptz,
    'an unconfirmed failure is since that failure');
SELECT is((SELECT noticed_at FROM pg_temp.status('eventbrite', 'link')), NULL::timestamptz,
    'a lone first failure is not alerted');
SELECT is((SELECT last_checked_at FROM pg_temp.status('eventbrite', 'link')), '2026-11-03 11:40+00'::timestamptz,
    'a lone first failure still counts as checked');
SELECT pg_temp.link('eventbrite', 'error', '2026-11-03 11:50+00');
SELECT is((SELECT state FROM pg_temp.status('eventbrite', 'link')), 'broken', 'its second failure makes it broken');
SELECT is((SELECT since FROM pg_temp.status('eventbrite', 'link')), '2026-11-03 11:40+00'::timestamptz,
    'broken since the first of the two failures');

-- 14. A failure after "no test event" keeps that state until a second failure confirms it.
SELECT pg_temp.link('facebook', 'error', '2026-11-03 11:50+00');
SELECT is((SELECT state FROM pg_temp.status('facebook', 'link')), 'no_test_event',
    'one failure after no_test_event does not turn the line green');
SELECT is((SELECT since FROM pg_temp.status('facebook', 'link')), '2026-11-03 10:40+00'::timestamptz,
    'and keeps its since');

-- 15. A finding window still in its first hour is not judged yet.
DELETE FROM public.service_health_events WHERE bucket = 'meetup' AND metadata ? 'page_read';
SELECT pg_temp.finding('meetup', 'finding', true, '2026-11-03 00:16+00');
SELECT pg_temp.finding('meetup', 'finding', false, '2026-11-03 06:16+00');
SELECT pg_temp.finding('meetup', 'finding', false, '2026-11-03 06:17+00');
SELECT pg_temp.finding('meetup', 'finding', false, '2026-11-03 12:16+00');
SELECT is((SELECT state FROM pg_temp.status_at('2026-11-03 12:20+00', 'meetup', 'finding')), 'working',
    'the first rows of a running window cannot break the line');
SELECT is((SELECT state FROM pg_temp.status_at('2026-11-03 13:30+00', 'meetup', 'finding')), 'broken',
    'once the window is an hour old it counts');
SELECT is((SELECT noticed_at FROM pg_temp.status_at('2026-11-03 13:30+00', 'meetup', 'finding')),
    '2026-11-03 13:00+00'::timestamptz, 'noticed when the second failed window first shows (13:00), not at its rows (12:16)');

-- 16. A row that lands after the window is already showing doesn't move the noticed time.
-- (A fully read 06:00 window first, so the failures follow a pass.)
DELETE FROM public.service_health_events
WHERE bucket = 'luma' AND metadata ? 'page_read' AND occurred_at < '2026-11-03 12:00+00';
SELECT pg_temp.finding('luma', 'finding', true, '2026-11-03 06:01+00');
SELECT pg_temp.finding('luma', 'finding', false, '2026-11-03 12:01+00');
SELECT pg_temp.finding('luma', 'finding', false, '2026-11-03 18:01+00');
SELECT pg_temp.finding('luma', 'finding', false, '2026-11-03 19:20+00');
SELECT is((SELECT state FROM pg_temp.status_at('2026-11-03 20:00+00', 'luma', 'finding')), 'broken',
    'two failed windows after a pass are broken');
SELECT is((SELECT since FROM pg_temp.status_at('2026-11-03 20:00+00', 'luma', 'finding')),
    '2026-11-03 12:01+00'::timestamptz, 'since stays at the first failed window''s rows');
SELECT is((SELECT noticed_at FROM pg_temp.status_at('2026-11-03 20:00+00', 'luma', 'finding')),
    '2026-11-03 19:00+00'::timestamptz, 'a straggler at 19:20 leaves noticed at 19:00, so a reader alerts once');

-- 17. A window whose first row lands after its first hour shows when that row lands.
SELECT pg_temp.finding('facebook', 'partner_pages', false, '2026-11-03 12:05+00');
SELECT pg_temp.finding('facebook', 'partner_pages', false, '2026-11-03 19:40+00');
SELECT is((SELECT state FROM pg_temp.status_at('2026-11-03 20:00+00', 'facebook', 'partner_pages')), 'broken',
    'a late window still counts once it has rows');
SELECT is((SELECT noticed_at FROM pg_temp.status_at('2026-11-03 20:00+00', 'facebook', 'partner_pages')),
    '2026-11-03 19:40+00'::timestamptz, 'noticed when its late first row landed (19:40), not at 19:00');

-- 18. Late rows that turn a showing window from pass to fail are noticed when they land.
DELETE FROM public.service_health_events WHERE bucket = 'meetup' AND metadata ? 'page_read';
SELECT pg_temp.finding('meetup', 'finding', true, '2026-11-03 06:05+00');
SELECT pg_temp.finding('meetup', 'finding', false, '2026-11-03 12:01+00');
SELECT pg_temp.finding('meetup', 'finding', true, '2026-11-03 18:01+00');
SELECT pg_temp.finding('meetup', 'finding', false, '2026-11-03 19:20+00');
SELECT pg_temp.finding('meetup', 'finding', false, '2026-11-03 19:21+00');
SELECT is((SELECT state FROM pg_temp.status_at('2026-11-03 19:10+00', 'meetup', 'finding')), 'working',
    'the window passes at 19:00 on its one read page, so the 12:00 failure is a blip');
SELECT is((SELECT state FROM pg_temp.status_at('2026-11-03 19:30+00', 'meetup', 'finding')), 'broken',
    'two unread pages at 19:20 and 19:21 turn the window into a failure');
SELECT is((SELECT noticed_at FROM pg_temp.status_at('2026-11-03 19:30+00', 'meetup', 'finding')),
    '2026-11-03 19:21+00'::timestamptz, 'noticed when the window turned failing (19:21), not when it opened (19:00)');

-- Shape: nine lines in page order.
SELECT results_eq(
    $$ SELECT sort_order, source, line FROM private.scraper_status_at('2026-11-03 12:00+00') $$,
    $$ VALUES (1, 'facebook', 'link'), (2, 'facebook', 'partner_pages'), (3, 'facebook', 'watched_pages'),
              (4, 'meetup', 'link'), (5, 'meetup', 'finding'), (6, 'luma', 'link'), (7, 'luma', 'finding'),
              (8, 'eventbrite', 'link'), (9, 'eventbrite', 'finding') $$,
    'nine lines in page order'
);
SELECT is((SELECT line_label FROM private.scraper_status_at('2026-11-03 12:00+00') WHERE sort_order = 1),
    'Importing from a link', 'line labels are plain words');
SELECT is((SELECT source_label FROM private.scraper_status_at('2026-11-03 12:00+00') WHERE sort_order = 6), 'Luma',
    'source labels are plain words');

-- Access: the API reaches only the public wrapper. Internal functions live in
-- the unexposed private schema, never behind a function-level REVOKE (an API
-- role denied EXECUTE segfaults Supabase's Postgres 17.6 image).
SELECT ok(has_function_privilege('anon', 'public.get_scraper_status()', 'execute'), 'anon can call get_scraper_status');
SELECT ok(has_function_privilege('authenticated', 'public.get_scraper_status()', 'execute'),
    'authenticated can call get_scraper_status');
SELECT ok(NOT has_schema_privilege('anon', 'private', 'usage'), 'anon has no usage on the private schema');
SELECT ok(NOT has_schema_privilege('authenticated', 'private', 'usage'),
    'authenticated has no usage on the private schema');
SELECT is((SELECT count(*) FROM public.get_scraper_status()), 9::bigint, 'get_scraper_status returns nine lines');

SET LOCAL ROLE anon;
SELECT is((SELECT count(*) FROM public.get_scraper_status()), 9::bigint, 'anon reads nine lines through the wrapper');
SELECT throws_ok('SELECT 1 FROM public.service_health_events', '42501', NULL,
    'anon still cannot read service_health_events');
SELECT throws_ok($$ SELECT 1 FROM private.scraper_status_at(now()) $$, '42501', 'permission denied for schema private',
    'anon cannot reach the internal function');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
