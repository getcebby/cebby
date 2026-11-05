-- service_health_bucket_summary: the old GitHub watchdog alerts on its typesense
-- row only (supabase/health/service-health-watchdog.sql), but the admin dashboard
-- reads every bucket, so the view keeps them all. Hourly link-check rows must not
-- change its verdicts, and the public anon key must not read it (it carries error
-- text and account ids).
BEGIN;
SELECT plan(9);

DELETE FROM public.service_health_events;

-- A cron success three hours ago, then a passed and a failed link check in the last hour.
INSERT INTO public.service_health_events (bucket, source, status, fingerprint, occurred_at) VALUES
    ('meetup', 'retrieve-and-sync-to-db-meetup-events', 'success', 'account_processed', now() - interval '3 hours'),
    ('meetup', 'link-check', 'success', 'link_check_passed', now() - interval '50 minutes'),
    ('meetup', 'link-check', 'error', 'link_check_failed', now() - interval '10 minutes');

SELECT is((SELECT errors_2h FROM public.service_health_bucket_summary WHERE bucket = 'meetup'), 0::bigint,
    'link-check failures do not count against the old error budgets');
SELECT is((SELECT latest_success_at FROM public.service_health_bucket_summary WHERE bucket = 'meetup'),
    now() - interval '3 hours', 'link-check passes do not refresh the old staleness check');
SELECT is((SELECT is_healthy FROM public.service_health_bucket_summary WHERE bucket = 'meetup'), true,
    'a link-check failure does not raise an unrecovered error');

-- Run-started rows (20261104020000) say a request was sent, not that scraping worked.
INSERT INTO public.service_health_events (bucket, source, status, fingerprint, metadata, occurred_at) VALUES
    ('meetup', 'scheduled-run', 'success', 'run_started', '{"line":"finding","expected":24}', now() - interval '5 minutes');
SELECT is((SELECT latest_success_at FROM public.service_health_bucket_summary WHERE bucket = 'meetup'),
    now() - interval '3 hours', 'a run-started row does not refresh the old staleness check');
SELECT is((SELECT successes_24h FROM public.service_health_bucket_summary WHERE bucket = 'meetup'), 1::bigint,
    'run-started rows are not counted as successes');

SELECT results_eq('SELECT bucket FROM public.service_health_bucket_summary ORDER BY bucket',
    $$ VALUES ('facebook'), ('luma'), ('meetup'), ('typesense') $$,
    'the view keeps every bucket for the admin dashboard, though the watchdog alerts on typesense only');

SELECT ok(NOT has_table_privilege('anon', 'public.service_health_bucket_summary', 'select'),
    'anon cannot read the watchdog view');
SELECT ok(NOT has_table_privilege('authenticated', 'public.service_health_bucket_summary', 'select'),
    'authenticated cannot read the watchdog view');

SET LOCAL ROLE anon;
SELECT throws_ok('SELECT 1 FROM public.service_health_bucket_summary', '42501', NULL,
    'anon reading the view gets a clean permission error');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
