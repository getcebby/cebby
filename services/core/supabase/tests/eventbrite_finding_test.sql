-- Eventbrite finding (20261105010000): the Cebu-based column, Eventbrite
-- organizers as finding targets, scheduled-run rows, the status line that is
-- no longer "not set up", history windows and the 6-hourly cron.
BEGIN;
SELECT plan(11);

-- 1-3. The column every platform will use for the Cebu rule.
SELECT has_column('public', 'accounts', 'is_cebu_based', 'accounts has is_cebu_based');
SELECT col_not_null('public', 'accounts', 'is_cebu_based', 'is_cebu_based is not null');
SELECT col_default_is('public', 'accounts', 'is_cebu_based', 'false', 'is_cebu_based defaults to false');

INSERT INTO public.accounts (account_id, name, type, kind, is_active)
VALUES ('eb-test-1', 'Active organizer', 'eventbrite', 'eventbrite_organizer', true),
       ('eb-test-2', 'Inactive organizer', 'eventbrite', 'eventbrite_organizer', false);

-- 4. Active Eventbrite organizers are finding targets; inactive ones aren't.
SELECT results_eq(
    $$SELECT source, line, account_id FROM public.finding_targets()
      WHERE account_id LIKE 'eb-test-%' ORDER BY account_id$$,
    $$VALUES ('eventbrite'::text, 'finding'::text, 'eb-test-1'::text)$$,
    'finding_targets lists active Eventbrite organizers only'
);

DELETE FROM public.service_health_events WHERE bucket = 'eventbrite';

-- 5. With no evidence, the line is an ordinary unchecked finding line.
SELECT is(
    (SELECT state FROM private.scraper_status_at(now()) WHERE source = 'eventbrite' AND line = 'finding'),
    'not_checked',
    'eventbrite finding with no results is not_checked, not not_set_up'
);

-- 6-7. A scheduled run records one started row with the expected count.
SELECT private.record_finding_runs('eventbrite');
SELECT is(
    (SELECT count(*)::int FROM public.service_health_events
     WHERE bucket = 'eventbrite' AND source = 'scheduled-run' AND metadata ->> 'line' = 'finding'),
    1,
    'record_finding_runs(eventbrite) writes one started row'
);
SELECT is(
    (SELECT (metadata ->> 'expected')::int FROM public.service_health_events
     WHERE bucket = 'eventbrite' AND source = 'scheduled-run' AND metadata ->> 'line' = 'finding'),
    (SELECT count(*)::int FROM public.finding_targets() WHERE source = 'eventbrite' AND line = 'finding'),
    'the started row expects every active Eventbrite organizer'
);

-- 8. An organizer's report shows up in its 6-hour history window.
INSERT INTO public.service_health_events (bucket, source, status, fingerprint, account_id, metadata, occurred_at)
VALUES ('eventbrite', 'retrieve-and-sync-to-db-eventbrite-events', 'success', 'account_processed', 'eb-test-1',
        '{"ingested": 0, "line": "finding", "page_read": true}', now() - interval '8 hours');
SELECT ok(
    EXISTS (SELECT 1 FROM private.scraper_history_at(now())
            WHERE source = 'eventbrite' AND line = 'finding'
              AND window_start = to_timestamp(floor(extract(epoch FROM now() - interval '8 hours') / 21600) * 21600)),
    'history has an Eventbrite finding window for the report'
);

-- 9-11. The cron runs at :45 every 6 hours, records its start, then fans out.
SELECT is(
    (SELECT schedule FROM cron.job WHERE jobname = 'sync-eventbrite-accounts'),
    '45 */6 * * *',
    'sync-eventbrite-accounts runs at :45 every 6 hours'
);
SELECT ok(
    (SELECT command FROM cron.job WHERE jobname = 'sync-eventbrite-accounts') LIKE '%record_finding_runs(''eventbrite'')%',
    'the cron records its start'
);
SELECT ok(
    (SELECT command FROM cron.job WHERE jobname = 'sync-eventbrite-accounts')
        LIKE '%fan_out_account_syncs(%''eventbrite''%retrieve-and-sync-to-db-eventbrite-events%',
    'the cron fans out to the Eventbrite sync'
);

SELECT * FROM finish();
ROLLBACK;
