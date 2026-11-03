-- Hourly link checks: which real events each source's check reads, and the
-- requests the cron sends. Never calls private.run_link_checks(): it posts to
-- the production function URLs.
BEGIN;
SELECT plan(17);

-- Start from no source links, whatever the local database already holds.
DELETE FROM public.event_source_links;

CREATE FUNCTION pg_temp.event(p_name text, p_start timestamptz, p_status text DEFAULT 'published',
                              p_format text DEFAULT 'in_person', p_location text DEFAULT 'IT Park, Cebu City')
RETURNS bigint LANGUAGE sql AS $$
    INSERT INTO public.events (name, start_time, status, format, location)
    VALUES (p_name, p_start, p_status::public.event_status, p_format::public.event_format, p_location)
    RETURNING id
$$;

CREATE FUNCTION pg_temp.link(p_event bigint, p_source text, p_url text, p_kind text DEFAULT 'public_scrape')
RETURNS void LANGUAGE sql AS $$
    INSERT INTO public.event_source_links (event_id, source, source_id, url, ingest_kind)
    VALUES (p_event, p_source, 'test-' || p_event, p_url, p_kind::public.ingest_kind)
$$;

-- Meetup: upcoming events first (soonest first), then past ones (most recent first), at most 3.
SELECT pg_temp.link(pg_temp.event('In 10 days', now() + interval '10 days'), 'meetup', 'https://www.meetup.com/g/events/10/');
SELECT pg_temp.link(pg_temp.event('Last week', now() - interval '7 days'), 'meetup', 'https://www.meetup.com/g/events/7/');
SELECT pg_temp.link(pg_temp.event('In 2 days', now() + interval '2 days'), 'meetup', 'https://www.meetup.com/g/events/2/');
SELECT pg_temp.link(pg_temp.event('Yesterday', now() - interval '1 day'), 'meetup', 'https://www.meetup.com/g/events/1/');
SELECT pg_temp.link(pg_temp.event('Hidden', now() + interval '1 day', 'hidden'), 'meetup', 'https://www.meetup.com/g/events/h/');
SELECT pg_temp.link(pg_temp.event('Manual', now() + interval '1 day'), 'meetup', 'https://www.meetup.com/g/events/m/', 'manual');

SELECT results_eq(
    $$ SELECT url FROM public.link_check_samples('meetup') $$,
    $$ VALUES ('https://www.meetup.com/g/events/2/'), ('https://www.meetup.com/g/events/10/'),
              ('https://www.meetup.com/g/events/1/') $$,
    'upcoming soonest first, then the most recent past event, limited to 3'
);
SELECT is((SELECT count(*) FROM public.link_check_samples('meetup') WHERE url LIKE '%/h/' OR url LIKE '%/m/'), 0::bigint,
    'hidden events and manual links are never samples');

-- Facebook: only event URLs, never page or profile URLs.
SELECT pg_temp.link(pg_temp.event('FB page link', now() + interval '3 days'), 'facebook', 'https://www.facebook.com/somepage');
SELECT pg_temp.link(pg_temp.event('FB event', now() + interval '4 days'), 'facebook',
    'https://www.facebook.com/events/2552868275211222/');
SELECT results_eq(
    $$ SELECT url FROM public.link_check_samples('facebook') $$,
    $$ VALUES ('https://www.facebook.com/events/2552868275211222/') $$,
    'facebook samples are event URLs only'
);

-- A location is expected only from in-person events that have one.
SELECT pg_temp.link(pg_temp.event('In person', now() + interval '1 day'), 'luma', 'https://luma.com/inperson');
SELECT pg_temp.link(pg_temp.event('Online', now() + interval '2 days', p_format => 'online', p_location => 'Online'),
    'luma', 'https://luma.com/online');
SELECT pg_temp.link(pg_temp.event('No venue yet', now() + interval '3 days', p_location => NULL), 'luma',
    'https://luma.com/novenue');
SELECT results_eq(
    $$ SELECT url, expect_location FROM public.link_check_samples('luma') $$,
    $$ VALUES ('https://luma.com/inperson', true), ('https://luma.com/online', false),
              ('https://luma.com/novenue', false) $$,
    'expect_location only for in-person events with a location'
);

SELECT is((SELECT count(*) FROM public.link_check_samples('eventbrite')), 0::bigint, 'no links means no samples');

-- Requests: one per source, check mode only. The function picks its own samples.
SELECT results_eq(
    $$ SELECT fn_name, body FROM private.link_check_requests() $$,
    $$ VALUES ('fb-scraper', '{"mode":"check"}'::jsonb), ('luma-scraper', '{"mode":"check"}'::jsonb),
              ('meetup-scraper', '{"mode":"check"}'::jsonb), ('eventbrite-scraper', '{"mode":"check"}'::jsonb) $$,
    'one check-mode request per scraper'
);

-- Schedule.
SELECT is((SELECT schedule FROM cron.job WHERE jobname = 'check-link-imports'), '40 * * * *',
    'check-link-imports runs hourly at :40');
SELECT ok((SELECT command FROM cron.job WHERE jobname = 'check-link-imports') LIKE '%private.run_link_checks()%',
    'the job runs private.run_link_checks()');

-- Access: run_link_checks and link_check_requests are unreachable over the API.
SELECT ok(NOT has_schema_privilege('anon', 'private', 'usage'), 'anon cannot reach private');
SELECT ok(NOT has_schema_privilege('authenticated', 'private', 'usage'), 'authenticated cannot reach private');
SELECT ok(has_function_privilege('service_role', 'public.link_check_samples(text, timestamptz)', 'execute'),
    'the scrapers (service_role) can load samples');
-- Every API role keeps EXECUTE on the public function: a denied function call
-- segfaults Supabase's Postgres 17.6 image (see 20261103010000_scraper_status.sql).
SELECT ok(has_function_privilege('anon', 'public.link_check_samples(text, timestamptz)', 'execute'),
    'anon keeps execute on link_check_samples (no denied-function path)');
SELECT ok(has_function_privilege('authenticated', 'public.link_check_samples(text, timestamptz)', 'execute'),
    'authenticated keeps execute on link_check_samples (no denied-function path)');
SELECT ok(has_function_privilege('postgres', 'private.run_link_checks()', 'execute'), 'the cron owner can run checks');

SET LOCAL ROLE anon;
-- anon may already read these columns (all but raw) through the REST API, so
-- the samples expose nothing new; the call must simply not fail.
SELECT results_eq(
    $$ SELECT url FROM public.link_check_samples('meetup') $$,
    $$ VALUES ('https://www.meetup.com/g/events/2/'), ('https://www.meetup.com/g/events/10/'),
              ('https://www.meetup.com/g/events/1/') $$,
    'anon sees the same samples it could already read from the REST API'
);
SELECT throws_ok($$ SELECT private.run_link_checks() $$, '42501', 'permission denied for schema private',
    'anon cannot trigger link checks');
SELECT throws_ok($$ SELECT * FROM private.link_check_requests() $$, '42501', 'permission denied for schema private',
    'anon cannot read the requests');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
