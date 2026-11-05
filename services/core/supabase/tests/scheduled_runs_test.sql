-- Evidence that scheduled checks started, and how many accounts each finding
-- line should report (migration 20261104020000). Never calls
-- private.run_link_checks(): it posts to the production function URLs.
BEGIN;
SELECT plan(14);

-- Only this test's accounts count (rolled back at the end).
UPDATE public.accounts SET is_active = false;
DELETE FROM public.service_health_events;

CREATE FUNCTION pg_temp.account(p_id text, p_type text, p_kind text, p_path text, p_active boolean DEFAULT true)
RETURNS void LANGUAGE sql AS $$
    INSERT INTO public.accounts (account_id, name, type, kind, ingest_kind, discovery_path, is_active)
    VALUES (p_id, 'Name of ' || p_id, p_type, 'test', p_kind::public.ingest_kind, p_path, p_active)
$$;

SELECT pg_temp.account('t-fb-partner', 'facebook', 'partnership', NULL);
INSERT INTO public.account_secrets (account_id, page_access_token) VALUES ('t-fb-partner', 'token');
SELECT pg_temp.account('t-fb-partner-user-token', 'facebook', 'partnership', NULL);
INSERT INTO public.account_secrets (account_id, access_token) VALUES ('t-fb-partner-user-token', 'token');
SELECT pg_temp.account('t-fb-empty-secret', 'facebook', 'public_scrape', 'emptysecret');
INSERT INTO public.account_secrets (account_id) VALUES ('t-fb-empty-secret');
SELECT pg_temp.account('t-fb-watched', 'facebook', 'public_scrape', 'somepage');
SELECT pg_temp.account('t-fb-no-path', 'facebook', 'public_scrape', NULL);
SELECT pg_temp.account('t-fb-blank-path', 'facebook', 'public_scrape', '  ');
SELECT pg_temp.account('t-fb-manual', 'facebook', 'manual', 'manualpage');
SELECT pg_temp.account('t-meetup', 'meetup', 'public_scrape', 'some-group');
SELECT pg_temp.account('t-meetup-off', 'meetup', 'public_scrape', 'old-group', false);
SELECT pg_temp.account('t-meetup-no-path', 'meetup', 'public_scrape', NULL);
SELECT pg_temp.account('t-luma', 'luma', 'public_scrape', 'awsugcebu');
SELECT pg_temp.account('t-eventbrite', 'eventbrite', 'public_scrape', 'some-org');

-- 1. Targets follow each cron handler's routing.
SELECT results_eq(
    $$ SELECT source, line, account_id FROM public.finding_targets() ORDER BY 1, 2, 3 $$,
    $$ VALUES ('facebook', 'partner_pages', 't-fb-partner'),
              ('facebook', 'partner_pages', 't-fb-partner-user-token'),
              ('facebook', 'watched_pages', 't-fb-empty-secret'),
              ('facebook', 'watched_pages', 't-fb-watched'),
              ('luma', 'finding', 't-luma'),
              ('meetup', 'finding', 't-meetup') $$,
    'partner pages have a token; watched pages are public_scrape with a path; meetup and luma need a path'
);
SELECT is((SELECT name FROM public.finding_targets() WHERE account_id = 't-luma'), 'Name of t-luma',
    'targets carry the account name for the admin page');

-- 2. A finding run records one row per line of its source, with the expected count.
SELECT private.record_finding_runs('facebook');
SELECT results_eq(
    $$ SELECT bucket, source, status, fingerprint, metadata ->> 'line', (metadata ->> 'expected')::int
       FROM public.service_health_events ORDER BY metadata ->> 'line' $$,
    $$ VALUES ('facebook', 'scheduled-run', 'success', 'run_started', 'partner_pages', 2),
              ('facebook', 'scheduled-run', 'success', 'run_started', 'watched_pages', 2) $$,
    'facebook records partner and watched runs with their expected accounts'
);

DELETE FROM public.service_health_events;
UPDATE public.accounts SET is_active = false WHERE account_id = 't-meetup';
SELECT private.record_finding_runs('meetup');
SELECT results_eq(
    $$ SELECT metadata ->> 'line', (metadata ->> 'expected')::int FROM public.service_health_events $$,
    $$ VALUES ('finding', 0) $$,
    'a line with no targets still records its run, expecting 0'
);

DELETE FROM public.service_health_events;
SELECT private.record_finding_runs('luma');
SELECT is((SELECT (metadata ->> 'expected')::int FROM public.service_health_events), 1, 'luma expects its one target');

-- 3. Link checks record one started row per source.
DELETE FROM public.service_health_events;
SELECT private.record_link_check_runs();
SELECT results_eq(
    $$ SELECT bucket, source, fingerprint, metadata FROM public.service_health_events ORDER BY bucket $$,
    $$ VALUES ('eventbrite', 'scheduled-run', 'run_started', '{"line":"link"}'::jsonb),
              ('facebook', 'scheduled-run', 'run_started', '{"line":"link"}'::jsonb),
              ('luma', 'scheduled-run', 'run_started', '{"line":"link"}'::jsonb),
              ('meetup', 'scheduled-run', 'run_started', '{"line":"link"}'::jsonb) $$,
    'one started row per link-checked source'
);
SELECT ok(pg_get_functiondef('private.run_link_checks()'::regprocedure) LIKE '%private.record_link_check_runs()%',
    'the hourly link checks record their start');

-- 4. The finding crons record their runs before fanning out.
SELECT ok((SELECT command FROM cron.job WHERE jobname = 'sync-luma-accounts')
    ~ 'private\.record_finding_runs\(''luma''\);\s*SELECT public\.fan_out_account_syncs\(\s*''luma''', 'luma cron records its run');
SELECT ok((SELECT command FROM cron.job WHERE jobname = 'sync-meetup-accounts')
    ~ 'private\.record_finding_runs\(''meetup''\);\s*SELECT public\.fan_out_account_syncs\(\s*''meetup''', 'meetup cron records its run');
SELECT ok((SELECT command FROM cron.job WHERE jobname = 'sync-fb-accounts')
    ~ 'private\.record_finding_runs\(''facebook''\);\s*SELECT public\.fan_out_account_syncs\(\s*''facebook''', 'facebook cron records its run');
SELECT ok((SELECT command FROM cron.job WHERE jobname = 'sync-fb-accounts')
    LIKE '%functions/v1/retrieve-and-sync-to-db-events%', 'facebook cron keeps its function URL');
SELECT is((SELECT count(*) FROM cron.job WHERE jobname IN ('sync-luma-accounts', 'sync-meetup-accounts', 'sync-fb-accounts')),
    3::bigint, 'still exactly one job per finding cron');

-- 5. API roles: targets read account_secrets with the caller's rights, so anon is refused.
SET LOCAL ROLE anon;
SELECT throws_ok('SELECT * FROM public.finding_targets()', '42501', NULL, 'anon cannot list targets');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT is((SELECT count(*) FROM public.finding_targets()), 5::bigint, 'service_role (the admin app) can list targets (t-meetup was deactivated above)');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
