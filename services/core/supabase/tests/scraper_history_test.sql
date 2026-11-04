-- History bars behind https://www.getcebby.com/status (private.scraper_history_at):
-- one row per check line and 6-hour UTC window over the last 7 days.
BEGIN;
SELECT plan(11);

DELETE FROM public.service_health_events;

CREATE FUNCTION pg_temp.link(p_bucket text, p_status text, p_at timestamptz)
RETURNS void LANGUAGE sql AS $$
    INSERT INTO public.service_health_events (bucket, source, status, fingerprint, metadata, occurred_at)
    VALUES (p_bucket, 'link-check', p_status, 'test', '{"line":"link","attempts":[]}', p_at)
$$;

CREATE FUNCTION pg_temp.finding(p_bucket text, p_line text, p_read boolean, p_at timestamptz)
RETURNS void LANGUAGE sql AS $$
    INSERT INTO public.service_health_events (bucket, source, status, fingerprint, metadata, occurred_at)
    VALUES (p_bucket, 'retrieve-and-sync', 'success', 'account_processed',
            jsonb_build_object('ingested', 0, 'line', p_line, 'page_read', p_read), p_at)
$$;

-- Link windows: all passed, some failed (partial), all failed, only "no test event".
SELECT pg_temp.link('meetup', 'success', '2026-11-03 00:40+00');
SELECT pg_temp.link('meetup', 'success', '2026-11-03 01:40+00');
SELECT pg_temp.link('meetup', 'success', '2026-11-03 02:40+00');
SELECT pg_temp.link('meetup', 'success', '2026-11-03 06:40+00');
SELECT pg_temp.link('meetup', 'error',   '2026-11-03 07:40+00');
SELECT pg_temp.link('luma', 'error', '2026-11-03 12:10+00');   -- the window in progress still shows
SELECT pg_temp.link('luma', 'error', '2026-11-03 13:10+00');
SELECT pg_temp.link('eventbrite', 'warning', '2026-11-03 06:40+00');
SELECT pg_temp.link('eventbrite', 'warning', '2026-11-03 07:40+00');
SELECT pg_temp.link('facebook', 'success', '2026-11-03 00:40+00');  -- a pass and a no-test-event: passed
SELECT pg_temp.link('facebook', 'warning', '2026-11-03 01:40+00');

-- Finding windows: pages read out of pages tried: all read passes, fewer than half fails,
-- anything between is partial.
SELECT pg_temp.finding('facebook', 'partner_pages', true,  '2026-11-03 00:31+00');
SELECT pg_temp.finding('facebook', 'partner_pages', false, '2026-11-03 00:31+00');
SELECT pg_temp.finding('facebook', 'partner_pages', false, '2026-11-03 00:32+00');
SELECT pg_temp.finding('facebook', 'partner_pages', true,  '2026-11-03 06:31+00');
SELECT pg_temp.finding('facebook', 'partner_pages', true,  '2026-11-03 06:31+00');
SELECT pg_temp.finding('facebook', 'partner_pages', true,  '2026-11-03 06:32+00');
SELECT pg_temp.finding('facebook', 'partner_pages', false, '2026-11-03 06:32+00');
SELECT pg_temp.finding('luma', 'finding', true, '2026-11-03 12:01+00');

-- The lookback starts at the 28th window back (Oct 27 18:00 when "now" is Nov 3 13:30).
SELECT pg_temp.finding('meetup', 'finding', true,  '2026-10-27 18:30+00');
SELECT pg_temp.finding('meetup', 'finding', false, '2026-10-27 17:59+00');

-- Rows the bars never use: a cron row without page_read, another bucket.
INSERT INTO public.service_health_events (bucket, source, status, fingerprint, metadata, occurred_at)
VALUES ('meetup', 'retrieve-and-sync', 'success', 'account_skipped', '{}', '2026-11-03 06:10+00'),
       ('core', 'link-check', 'error', 'test', '{"line":"link"}', '2026-11-03 06:10+00');

SELECT results_eq(
    $$ SELECT source, line, window_start, checks, passed, failed, result
       FROM private.scraper_history_at('2026-11-03 13:30+00') $$,
    $$ VALUES ('eventbrite', 'link',          '2026-11-03 06:00+00'::timestamptz, 2, 0, 0, 'no_sample'),
              ('facebook',   'link',          '2026-11-03 00:00+00'::timestamptz, 2, 1, 0, 'pass'),
              ('facebook',   'partner_pages', '2026-11-03 00:00+00'::timestamptz, 3, 1, 2, 'fail'),
              ('facebook',   'partner_pages', '2026-11-03 06:00+00'::timestamptz, 4, 3, 1, 'partial'),
              ('luma',       'finding',       '2026-11-03 12:00+00'::timestamptz, 1, 1, 0, 'pass'),
              ('luma',       'link',          '2026-11-03 12:00+00'::timestamptz, 2, 0, 2, 'fail'),
              ('meetup',     'finding',       '2026-10-27 18:00+00'::timestamptz, 1, 1, 0, 'pass'),
              ('meetup',     'link',          '2026-11-03 00:00+00'::timestamptz, 3, 3, 0, 'pass'),
              ('meetup',     'link',          '2026-11-03 06:00+00'::timestamptz, 2, 1, 1, 'partial') $$,
    'one row per line and 6-hour window: counts and result'
);

SELECT is((SELECT count(*)::int FROM private.scraper_history_at('2026-11-03 12:30+00')
           WHERE source = 'luma' AND line = 'finding'), 0,
    'a finding window in its first hour is not shown yet, as on the status line');

SELECT is((SELECT count(*)::int FROM private.scraper_history_at('2026-11-03 13:30+00')
           WHERE window_start > '2026-11-03 13:30+00'), 0, 'nothing after "now"');

-- Started runs (20261104020000): scheduled and missed link checks, expected and missing accounts.
DELETE FROM public.service_health_events;
CREATE FUNCTION pg_temp.run(p_bucket text, p_line text, p_expected int, p_at timestamptz)
RETURNS void LANGUAGE sql AS $$
    INSERT INTO public.service_health_events (bucket, source, status, fingerprint, metadata, occurred_at)
    VALUES (p_bucket, 'scheduled-run', 'success', 'run_started',
            CASE WHEN p_expected IS NULL THEN jsonb_build_object('line', p_line)
                 ELSE jsonb_build_object('line', p_line, 'expected', p_expected) END, p_at)
$$;
-- Meetup link checks 18:40 to 23:40: six started, the 21:40 one never reported.
SELECT pg_temp.run('meetup', 'link', NULL, '2026-11-03 18:40+00'::timestamptz + h * interval '1 hour') FROM generate_series(0, 5) h;
SELECT pg_temp.link('meetup', 'success', '2026-11-03 18:40:05+00'::timestamptz + h * interval '1 hour')
FROM generate_series(0, 5) h WHERE h <> 3;
-- Luma link checks that started but never reported, the newest only 5 minutes ago.
SELECT pg_temp.run('luma', 'link', NULL, '2026-11-04 00:40+00');
SELECT pg_temp.run('luma', 'link', NULL, '2026-11-04 01:25+00');
-- Watched pages: 22 expected, 16 reported, none read.
SELECT pg_temp.run('facebook', 'watched_pages', 22, '2026-11-04 00:30+00');
INSERT INTO public.service_health_events (bucket, source, status, fingerprint, account_id, metadata, occurred_at)
SELECT 'facebook', 'retrieve-and-sync', 'success', 'account_processed', 'w' || i,
       '{"line":"watched_pages","page_read":false}', '2026-11-04 00:30:04+00'
FROM generate_series(1, 16) i;
-- Partner pages: the run started and nothing reported.
SELECT pg_temp.run('facebook', 'partner_pages', 15, '2026-11-04 00:30+00');

SELECT results_eq(
    $$ SELECT source, line, window_start, checks, passed, failed, expected, missed, result
       FROM private.scraper_history_at('2026-11-04 01:30+00') ORDER BY source, line, window_start $$,
    $$ VALUES ('facebook', 'partner_pages', '2026-11-04 00:00+00'::timestamptz, 0, 0, 0, 15, 15, 'missed'),
              ('facebook', 'watched_pages', '2026-11-04 00:00+00'::timestamptz, 16, 0, 16, 22, 6, 'fail'),
              ('luma',     'link',          '2026-11-04 00:00+00'::timestamptz, 0, 0, 0, 2, 1, 'missed'),
              ('meetup',   'link',          '2026-11-03 18:00+00'::timestamptz, 5, 5, 0, 6, 1, 'pass') $$,
    'started runs give each window its scheduled or expected count and what never reported'
);
SELECT is((SELECT count(*)::int FROM private.scraper_history_at('2026-11-04 00:50+00')
           WHERE source = 'facebook' AND line = 'partner_pages'), 0,
    'a finding run that reported nothing shows as missed only once its window is an hour old');
SELECT is((SELECT count(*)::int FROM private.scraper_history_at('2026-11-04 00:45+00')
           WHERE source = 'luma' AND line = 'link'), 0, 'a check started 5 minutes ago is not missed yet');
SELECT pg_temp.run('meetup', 'finding', 0, '2026-11-04 00:15+00');
SELECT is((SELECT count(*)::int FROM private.scraper_history_at('2026-11-04 01:30+00')
           WHERE source = 'meetup' AND line = 'finding'), 0, 'a run expecting no accounts has nothing to miss');

-- Rows from before run rows existed have no expected or missed count.
SELECT pg_temp.finding('luma', 'finding', true, '2026-11-03 12:01+00');
SELECT results_eq(
    $$ SELECT expected, missed FROM private.scraper_history_at('2026-11-04 01:30+00')
       WHERE source = 'luma' AND line = 'finding' $$,
    $$ VALUES (NULL::int, NULL::int) $$,
    'no run row: expected and missed are unknown'
);

SELECT is(pg_get_function_result('public.get_scraper_history()'::regprocedure),
    'TABLE(source text, line text, window_start timestamp with time zone, checks integer, passed integer, failed integer, result text, expected integer, missed integer)',
    'get_scraper_history returns counts only');

SELECT ok(has_function_privilege('anon', 'public.get_scraper_history()', 'execute'), 'anon can call get_scraper_history');
SELECT ok(has_function_privilege('authenticated', 'public.get_scraper_history()', 'execute'),
    'authenticated can call get_scraper_history');

SELECT * FROM finish();
ROLLBACK;
