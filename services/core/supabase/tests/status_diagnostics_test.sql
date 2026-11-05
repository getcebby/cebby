-- Status rules added by 20261104020000: finding windows judged against the
-- accounts a run should report, the degraded state, missed runs, the
-- internal counts behind `latest` and `unread`, and the public wrapper that
-- returns no counts. The older rules are in scraper_status_test.sql.
BEGIN;
SELECT plan(72);

DELETE FROM public.service_health_events;

CREATE FUNCTION pg_temp.st(p_now timestamptz, p_source text, p_line text)
RETURNS TABLE(state text, since timestamptz, noticed_at timestamptz, last_worked_at timestamptz,
              last_checked_at timestamptz, last_run_at timestamptz, missed_runs int, latest jsonb, unread text)
LANGUAGE sql AS $$
    SELECT state, since, noticed_at, last_worked_at, last_checked_at, last_run_at, missed_runs, latest, unread
    FROM private.scraper_status_at(p_now) WHERE source = p_source AND line = p_line
$$;

-- A scheduled run started (expected is null for link checks).
CREATE FUNCTION pg_temp.run(p_bucket text, p_line text, p_expected int, p_at timestamptz)
RETURNS void LANGUAGE sql AS $$
    INSERT INTO public.service_health_events (bucket, source, status, fingerprint, metadata, occurred_at)
    VALUES (p_bucket, 'scheduled-run', 'success', 'run_started',
            CASE WHEN p_expected IS NULL THEN jsonb_build_object('line', p_line)
                 ELSE jsonb_build_object('line', p_line, 'expected', p_expected) END, p_at)
$$;

-- One account's finding row.
CREATE FUNCTION pg_temp.acct(p_bucket text, p_line text, p_account text, p_read boolean, p_at timestamptz)
RETURNS void LANGUAGE sql AS $$
    INSERT INTO public.service_health_events (bucket, source, status, fingerprint, account_id, metadata, occurred_at)
    VALUES (p_bucket, 'retrieve-and-sync', 'success', 'account_processed', p_account,
            jsonb_build_object('ingested', 0, 'line', p_line, 'page_read', p_read), p_at)
$$;

-- A run's reports: n_read accounts read, then n_unread not read, all at p_at.
CREATE FUNCTION pg_temp.reports(p_bucket text, p_line text, n_read int, n_unread int, p_at timestamptz)
RETURNS void LANGUAGE sql AS $$
    SELECT pg_temp.acct(p_bucket, p_line, 'a' || i, i <= n_read, p_at) FROM generate_series(1, n_read + n_unread) i
$$;

CREATE FUNCTION pg_temp.link(p_bucket text, p_status text, p_at timestamptz)
RETURNS void LANGUAGE sql AS $$
    INSERT INTO public.service_health_events (bucket, source, status, fingerprint, metadata, occurred_at)
    VALUES (p_bucket, 'link-check', p_status, 'test', '{"line":"link","attempts":[]}', p_at)
$$;

-- 1. Judged against the expected accounts: 16 of 22 reported.
SELECT pg_temp.run('facebook', 'watched_pages', 22, '2026-11-04 00:30+00');
SELECT pg_temp.reports('facebook', 'watched_pages', 0, 16, '2026-11-04 00:30:04+00');
SELECT is((SELECT latest FROM pg_temp.st('2026-11-04 02:00+00', 'facebook', 'watched_pages')),
    jsonb_build_object('result', 'fail', 'at', '2026-11-04 00:30:04+00'::timestamptz, 'window_start',
        '2026-11-04 00:00+00'::timestamptz, 'expected', 22, 'reported', 16, 'read', 0),
    'latest carries the window''s counts: 0 of 16 reported read, 22 expected');
SELECT is((SELECT unread FROM pg_temp.st('2026-11-04 02:00+00', 'facebook', 'watched_pages')), 'all',
    'none of the expected pages read: unread is all');
SELECT is((SELECT state FROM pg_temp.st('2026-11-04 02:00+00', 'facebook', 'watched_pages')), 'unconfirmed',
    'a lone first failure is still unconfirmed');

DELETE FROM public.service_health_events;
SELECT pg_temp.run('facebook', 'watched_pages', 22, '2026-11-04 00:30+00');
SELECT pg_temp.reports('facebook', 'watched_pages', 16, 0, '2026-11-04 00:30:04+00');
SELECT is((SELECT latest ->> 'result' FROM pg_temp.st('2026-11-04 02:00+00', 'facebook', 'watched_pages')), 'partial',
    'every reported page read, but 6 of 22 never reported: partial');
SELECT is((SELECT unread FROM pg_temp.st('2026-11-04 02:00+00', 'facebook', 'watched_pages')), 'some',
    '16 of 22 read: unread is some');
SELECT is((SELECT state FROM pg_temp.st('2026-11-04 02:00+00', 'facebook', 'watched_pages')), 'unconfirmed',
    'a lone first partial is unconfirmed');
SELECT is((SELECT since FROM pg_temp.st('2026-11-04 02:00+00', 'facebook', 'watched_pages')),
    '2026-11-04 00:30:04+00'::timestamptz, 'unconfirmed since that window''s rows');
SELECT is((SELECT noticed_at FROM pg_temp.st('2026-11-04 02:00+00', 'facebook', 'watched_pages')), NULL::timestamptz,
    'a lone first partial is not alerted');

SELECT pg_temp.run('facebook', 'watched_pages', 22, '2026-11-04 06:30+00');
SELECT pg_temp.reports('facebook', 'watched_pages', 16, 0, '2026-11-04 06:30:04+00');
SELECT is((SELECT state FROM pg_temp.st('2026-11-04 08:00+00', 'facebook', 'watched_pages')), 'degraded',
    'two partial windows in a row are degraded');
SELECT is((SELECT since FROM pg_temp.st('2026-11-04 08:00+00', 'facebook', 'watched_pages')),
    '2026-11-04 00:30:04+00'::timestamptz, 'degraded since the first partial window');
SELECT is((SELECT noticed_at FROM pg_temp.st('2026-11-04 08:00+00', 'facebook', 'watched_pages')),
    '2026-11-04 07:00+00'::timestamptz, 'noticed when the second partial window first shows');

-- Without a run row (rows from before this migration) the reports are the expected set.
DELETE FROM public.service_health_events;
SELECT pg_temp.reports('facebook', 'partner_pages', 12, 3, '2026-11-04 00:31+00');
SELECT is((SELECT latest FROM pg_temp.st('2026-11-04 02:00+00', 'facebook', 'partner_pages')) ->> 'result', 'partial',
    '12 of 15 read with no run row is partial');
SELECT is((SELECT latest FROM pg_temp.st('2026-11-04 02:00+00', 'facebook', 'partner_pages')) -> 'expected', 'null'::jsonb,
    'expected is null without a run row');

-- 2. Transitions on one line: blip, degraded, broken, back to degraded, healthy.
DELETE FROM public.service_health_events;
SELECT pg_temp.run('meetup', 'finding', 10, '2026-11-03 00:15+00');
SELECT pg_temp.reports('meetup', 'finding', 10, 0, '2026-11-03 00:15:10+00');
SELECT pg_temp.run('meetup', 'finding', 10, '2026-11-03 06:15+00');
SELECT pg_temp.reports('meetup', 'finding', 8, 2, '2026-11-03 06:15:10+00');
SELECT is((SELECT state FROM pg_temp.st('2026-11-03 08:00+00', 'meetup', 'finding')), 'working',
    'one partial window after a pass is a blip');
SELECT is((SELECT last_worked_at FROM pg_temp.st('2026-11-03 08:00+00', 'meetup', 'finding')),
    '2026-11-03 00:15:10+00'::timestamptz, 'last worked is the fully read window');
SELECT is((SELECT unread FROM pg_temp.st('2026-11-03 08:00+00', 'meetup', 'finding')), 'some',
    'a blip says how much of the latest window was not read');

SELECT pg_temp.run('meetup', 'finding', 10, '2026-11-03 12:15+00');
SELECT pg_temp.reports('meetup', 'finding', 8, 2, '2026-11-03 12:15:10+00');
SELECT is((SELECT state FROM pg_temp.st('2026-11-03 14:00+00', 'meetup', 'finding')), 'degraded',
    'a second partial window is degraded');
SELECT is((SELECT since FROM pg_temp.st('2026-11-03 14:00+00', 'meetup', 'finding')),
    '2026-11-03 06:15:10+00'::timestamptz, 'degraded since the first partial window');
SELECT is((SELECT noticed_at FROM pg_temp.st('2026-11-03 14:00+00', 'meetup', 'finding')),
    '2026-11-03 13:00+00'::timestamptz, 'degraded noticed when the second partial window showed');

SELECT pg_temp.run('meetup', 'finding', 10, '2026-11-03 18:15+00');
SELECT pg_temp.reports('meetup', 'finding', 2, 8, '2026-11-03 18:15:10+00');
SELECT is((SELECT state FROM pg_temp.st('2026-11-03 20:00+00', 'meetup', 'finding')), 'degraded',
    'one failed window after partial ones stays degraded');
SELECT is((SELECT unread FROM pg_temp.st('2026-11-03 20:00+00', 'meetup', 'finding')), 'most',
    '2 of 10 read: unread is most');
SELECT is((SELECT noticed_at FROM pg_temp.st('2026-11-03 20:00+00', 'meetup', 'finding')),
    '2026-11-03 13:00+00'::timestamptz, 'and does not alert again');

SELECT pg_temp.run('meetup', 'finding', 10, '2026-11-04 00:15+00');
SELECT pg_temp.reports('meetup', 'finding', 1, 9, '2026-11-04 00:15:10+00');
SELECT is((SELECT state FROM pg_temp.st('2026-11-04 02:00+00', 'meetup', 'finding')), 'broken',
    'two failed windows in a row are broken');
SELECT is((SELECT since FROM pg_temp.st('2026-11-04 02:00+00', 'meetup', 'finding')),
    '2026-11-03 06:15:10+00'::timestamptz, 'broken keeps the problem''s start');
SELECT is((SELECT noticed_at FROM pg_temp.st('2026-11-04 02:00+00', 'meetup', 'finding')),
    '2026-11-04 01:00+00'::timestamptz, 'getting worse alerts again: noticed at the second failed window');
SELECT is((SELECT unread FROM pg_temp.st('2026-11-04 02:00+00', 'meetup', 'finding')), 'most',
    'broken after 2 and then 1 of 10 read: most were not read in both runs');

SELECT pg_temp.run('meetup', 'finding', 10, '2026-11-04 06:15+00');
SELECT pg_temp.reports('meetup', 'finding', 8, 2, '2026-11-04 06:15:10+00');
SELECT is((SELECT state FROM pg_temp.st('2026-11-04 08:00+00', 'meetup', 'finding')), 'degraded',
    'a partial window after a broken run is degraded');
SELECT is((SELECT noticed_at FROM pg_temp.st('2026-11-04 08:00+00', 'meetup', 'finding')),
    '2026-11-03 13:00+00'::timestamptz, 'getting better does not alert');

SELECT pg_temp.run('meetup', 'finding', 10, '2026-11-04 12:15+00');
SELECT pg_temp.reports('meetup', 'finding', 10, 0, '2026-11-04 12:15:10+00');
SELECT is((SELECT state FROM pg_temp.st('2026-11-04 14:00+00', 'meetup', 'finding')), 'working',
    'a fully read window recovers');
SELECT is((SELECT since FROM pg_temp.st('2026-11-04 14:00+00', 'meetup', 'finding')), NULL::timestamptz,
    'recovered has no since');
SELECT is((SELECT noticed_at FROM pg_temp.st('2026-11-04 14:00+00', 'meetup', 'finding')), NULL::timestamptz,
    'recovered has no noticed');
SELECT is((SELECT last_worked_at FROM pg_temp.st('2026-11-04 14:00+00', 'meetup', 'finding')),
    '2026-11-04 12:15:10+00'::timestamptz, 'recovered last worked now');

-- 3. A window still landing is not judged; reruns and double fires count once.
SELECT is((SELECT latest ->> 'window_start' FROM pg_temp.st('2026-11-04 12:45+00', 'meetup', 'finding'))::timestamptz,
    '2026-11-04 06:00+00'::timestamptz, 'a window 30 minutes old is not judged yet');
SELECT is((SELECT state FROM pg_temp.st('2026-11-04 12:45+00', 'meetup', 'finding')), 'degraded',
    'so the line keeps its state until the window is an hour old');

-- Late reports that improve a failed window to partial keep the degraded notice time:
-- the line didn't get worse, so a reader mustn't alert again.
DELETE FROM public.service_health_events;
SELECT pg_temp.run('luma', 'finding', 4, '2026-11-04 00:00+00');
SELECT pg_temp.reports('luma', 'finding', 3, 1, '2026-11-04 00:00:10+00');
SELECT pg_temp.run('luma', 'finding', 4, '2026-11-04 06:00+00');
SELECT pg_temp.acct('luma', 'finding', 'b1', false, '2026-11-04 06:00:10+00');
SELECT pg_temp.acct('luma', 'finding', 'b2', false, '2026-11-04 06:00:10+00');
SELECT is((SELECT noticed_at FROM pg_temp.st('2026-11-04 07:05+00', 'luma', 'finding')),
    '2026-11-04 07:00+00'::timestamptz, 'degraded once the failing window shows');
SELECT pg_temp.acct('luma', 'finding', 'b3', true, '2026-11-04 07:10+00');
SELECT pg_temp.acct('luma', 'finding', 'b4', true, '2026-11-04 07:10+00');
SELECT is((SELECT latest ->> 'result' FROM pg_temp.st('2026-11-04 07:20+00', 'luma', 'finding')), 'partial',
    'late reads turn the window from failed to partial');
SELECT is((SELECT state FROM pg_temp.st('2026-11-04 07:20+00', 'luma', 'finding')), 'degraded', 'still degraded');
SELECT is((SELECT noticed_at FROM pg_temp.st('2026-11-04 07:20+00', 'luma', 'finding')),
    '2026-11-04 07:00+00'::timestamptz, 'an improvement does not move the noticed time');

-- An account reporting again replays the window with its earlier report in place:
-- a later read failure that makes the line broken is noticed when it lands.
DELETE FROM public.service_health_events;
SELECT pg_temp.run('meetup', 'finding', 2, '2026-11-04 00:15+00');
SELECT pg_temp.reports('meetup', 'finding', 0, 2, '2026-11-04 00:15:10+00');
SELECT pg_temp.run('meetup', 'finding', 2, '2026-11-04 06:00+00');
SELECT pg_temp.acct('meetup', 'finding', 'c1', true, '2026-11-04 06:05+00');
SELECT pg_temp.acct('meetup', 'finding', 'c2', false, '2026-11-04 06:06+00');
SELECT is((SELECT state FROM pg_temp.st('2026-11-04 08:00+00', 'meetup', 'finding')), 'degraded',
    'a partial window after a failed one is degraded');
SELECT pg_temp.acct('meetup', 'finding', 'c1', false, '2026-11-04 09:10+00');
SELECT is((SELECT state FROM pg_temp.st('2026-11-04 09:20+00', 'meetup', 'finding')), 'broken',
    'the account failing on its second report makes the window a failure');
SELECT is((SELECT noticed_at FROM pg_temp.st('2026-11-04 09:20+00', 'meetup', 'finding')),
    '2026-11-04 09:10+00'::timestamptz, 'broken is noticed when that report landed, not backdated to 07:00');
SELECT is((SELECT latest - 'at' - 'window_start' FROM pg_temp.st('2026-11-04 09:20+00', 'meetup', 'finding')),
    '{"result":"fail","expected":2,"reported":2,"read":0}'::jsonb, 'the counts use each account''s latest report');
SELECT is((SELECT unread FROM pg_temp.st('2026-11-04 09:20+00', 'meetup', 'finding')), 'all',
    'broken with nothing read in either run: unread is all');

-- Broken's unread holds for both runs: the less severe of the two.
DELETE FROM public.service_health_events;
SELECT pg_temp.run('luma', 'finding', 4, '2026-11-04 00:00+00');
SELECT pg_temp.reports('luma', 'finding', 1, 3, '2026-11-04 00:00:10+00');
SELECT pg_temp.run('luma', 'finding', 4, '2026-11-04 06:00+00');
SELECT pg_temp.reports('luma', 'finding', 0, 4, '2026-11-04 06:00:10+00');
SELECT is((SELECT state FROM pg_temp.st('2026-11-04 07:05+00', 'luma', 'finding')), 'broken', 'two failed windows');
SELECT is((SELECT unread FROM pg_temp.st('2026-11-04 07:05+00', 'luma', 'finding')), 'most',
    'none read in the latest, 1 of 4 in the one before: most, not all');

-- A run where most accounts never reported is partial (every report read), and most were not read.
DELETE FROM public.service_health_events;
SELECT pg_temp.run('meetup', 'finding', 10, '2026-11-04 00:15+00');
SELECT pg_temp.reports('meetup', 'finding', 4, 0, '2026-11-04 00:15:10+00');
SELECT is((SELECT latest ->> 'result' FROM pg_temp.st('2026-11-04 02:00+00', 'meetup', 'finding')), 'partial',
    '4 of 10 reported, all read: partial');
SELECT is((SELECT unread FROM pg_temp.st('2026-11-04 02:00+00', 'meetup', 'finding')), 'most',
    'but most of the expected accounts were not read');

DELETE FROM public.service_health_events;
SELECT pg_temp.run('luma', 'finding', 2, '2026-11-04 00:00+00');
SELECT pg_temp.run('luma', 'finding', 2, '2026-11-04 00:05+00');
SELECT pg_temp.acct('luma', 'finding', 'a1', false, '2026-11-04 00:00:05+00');
SELECT pg_temp.acct('luma', 'finding', 'a2', true, '2026-11-04 00:00:06+00');
SELECT pg_temp.acct('luma', 'finding', 'a1', true, '2026-11-04 00:05:05+00');
SELECT is((SELECT latest FROM pg_temp.st('2026-11-04 02:00+00', 'luma', 'finding')) - 'at' - 'window_start',
    '{"result":"pass","expected":2,"reported":2,"read":2}'::jsonb,
    'an account reporting twice counts once (its latest row), and a double fire does not double expected');

-- 4. Missed runs: started, never reported.
DELETE FROM public.service_health_events;
SELECT pg_temp.run('meetup', 'link', NULL, '2026-11-04 10:40+00');
SELECT pg_temp.link('meetup', 'success', '2026-11-04 10:40:03+00');
SELECT pg_temp.run('meetup', 'link', NULL, '2026-11-04 11:40+00');
SELECT is((SELECT missed_runs FROM pg_temp.st('2026-11-04 11:45+00', 'meetup', 'link')), 0,
    'a check started 5 minutes ago is not missed yet');
SELECT is((SELECT missed_runs FROM pg_temp.st('2026-11-04 11:55+00', 'meetup', 'link')), 1,
    'a check with no result after 10 minutes is missed');
SELECT is((SELECT state FROM pg_temp.st('2026-11-04 11:55+00', 'meetup', 'link')), 'working',
    'one missed check leaves the line working');
SELECT is((SELECT last_run_at FROM pg_temp.st('2026-11-04 11:55+00', 'meetup', 'link')),
    '2026-11-04 11:40+00'::timestamptz, 'last_run_at is the latest start');

SELECT pg_temp.run('meetup', 'link', NULL, '2026-11-04 12:40+00');
SELECT pg_temp.run('meetup', 'link', NULL, '2026-11-04 13:40+00');
SELECT is((SELECT state FROM pg_temp.st('2026-11-04 13:55+00', 'meetup', 'link')), 'not_checked',
    'no result for over 3 hours is not checked, even while checks keep starting');
SELECT is((SELECT missed_runs FROM pg_temp.st('2026-11-04 13:55+00', 'meetup', 'link')), 3,
    'the three checks since the last result are missed');
SELECT ok((SELECT last_run_at > last_checked_at FROM pg_temp.st('2026-11-04 13:55+00', 'meetup', 'link')),
    'checks are starting but not finishing');

SELECT pg_temp.link('luma', 'success', '2026-11-04 08:40+00');
SELECT is((SELECT state FROM pg_temp.st('2026-11-04 12:00+00', 'luma', 'link')), 'not_checked',
    'a stale line with no starts');
SELECT is((SELECT last_run_at FROM pg_temp.st('2026-11-04 12:00+00', 'luma', 'link')), NULL::timestamptz,
    'has no last_run_at: no check has started');
SELECT is((SELECT missed_runs FROM pg_temp.st('2026-11-04 12:00+00', 'luma', 'link')), 0, 'and nothing missed');

SELECT pg_temp.run('facebook', 'partner_pages', 15, '2026-11-04 00:30+00');
SELECT pg_temp.reports('facebook', 'partner_pages', 15, 0, '2026-11-04 00:30:10+00');
SELECT pg_temp.run('facebook', 'partner_pages', 15, '2026-11-04 06:30+00');
SELECT is((SELECT state FROM pg_temp.st('2026-11-04 12:00+00', 'facebook', 'partner_pages')), 'working',
    'a finding run that started and reported nothing is not a failure');
SELECT is((SELECT missed_runs FROM pg_temp.st('2026-11-04 12:00+00', 'facebook', 'partner_pages')), 1,
    'it is a missed run');
SELECT is((SELECT latest ->> 'window_start' FROM pg_temp.st('2026-11-04 12:00+00', 'facebook', 'partner_pages'))::timestamptz,
    '2026-11-04 00:00+00'::timestamptz, 'latest stays the last window that reported');

SELECT pg_temp.run('luma', 'finding', 0, '2026-11-04 06:00+00');
SELECT is((SELECT missed_runs FROM pg_temp.st('2026-11-04 12:00+00', 'luma', 'finding')), 0,
    'a run expecting no accounts that reports nothing has not missed anything');

-- 5. Broken recovers straight to working.
DELETE FROM public.service_health_events;
SELECT pg_temp.link('eventbrite', 'error', '2026-11-04 09:40+00');
SELECT pg_temp.link('eventbrite', 'error', '2026-11-04 10:40+00');
SELECT is((SELECT state FROM pg_temp.st('2026-11-04 11:00+00', 'eventbrite', 'link')), 'broken', 'two failed checks');
SELECT pg_temp.link('eventbrite', 'success', '2026-11-04 11:40+00');
SELECT is((SELECT state FROM pg_temp.st('2026-11-04 12:00+00', 'eventbrite', 'link')), 'working',
    'a pass after broken is working');
SELECT is((SELECT latest FROM pg_temp.st('2026-11-04 12:00+00', 'eventbrite', 'link')),
    jsonb_build_object('result', 'pass', 'at', '2026-11-04 11:40+00'::timestamptz), 'a link latest is its result and time');
SELECT is((SELECT unread FROM pg_temp.st('2026-11-04 12:00+00', 'eventbrite', 'link')), NULL::text,
    'a link line has no unread');

-- 6. Not configured carries no run data.
SELECT is((SELECT latest FROM pg_temp.st('2026-11-04 12:00+00', 'eventbrite', 'finding')), NULL::jsonb,
    'not set up has no latest');
SELECT is((SELECT missed_runs FROM pg_temp.st('2026-11-04 12:00+00', 'eventbrite', 'finding')), NULL::int,
    'not set up has no missed runs');

-- 7. The public wrapper: states, times and coarse words, never counts.
SELECT is(pg_get_function_result('public.get_scraper_status()'::regprocedure),
    'TABLE(sort_order integer, source text, source_label text, line text, line_label text, state text, since timestamp with time zone, last_worked_at timestamp with time zone, last_checked_at timestamp with time zone, noticed_at timestamp with time zone, last_run_at timestamp with time zone, latest_result text, unread text, missed_run boolean)',
    'get_scraper_status returns only these columns');
SELECT ok(has_function_privilege('anon', 'public.get_scraper_status()', 'execute'), 'anon can still call it');

-- Rows relative to now(): the wrapper reads the live clock. The previous
-- 6-hour window closed over an hour ago, so it is judged.
DELETE FROM public.service_health_events;
SELECT pg_temp.run('luma', 'finding', 10, to_timestamp(floor(extract(epoch FROM now()) / 21600) * 21600 - 21600));
SELECT pg_temp.reports('luma', 'finding', 4, 0, to_timestamp(floor(extract(epoch FROM now()) / 21600) * 21600 - 21600 + 10));
SELECT pg_temp.link('luma', 'error', now() - interval '50 minutes');
SELECT pg_temp.run('luma', 'link', NULL, now() - interval '30 minutes');
SET LOCAL ROLE anon;
SELECT is((SELECT count(*) FROM public.get_scraper_status()), 9::bigint, 'anon reads nine lines');
SELECT results_eq(
    $$ SELECT line, latest_result, unread, missed_run FROM public.get_scraper_status()
       WHERE source IN ('luma', 'eventbrite') ORDER BY sort_order $$,
    $$ VALUES ('link'::text, 'fail'::text, NULL::text, true),
              ('finding', 'partial', 'most', false),
              ('link', NULL, NULL, false),
              ('finding', NULL, NULL, NULL) $$,
    'anon gets the latest result, a coarse unread word and whether a run was missed');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
