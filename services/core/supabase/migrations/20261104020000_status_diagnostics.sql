-- ============================================================================
-- /status diagnostics: run-started evidence, expected accounts, partial runs
-- ============================================================================
--
-- Spec: docs/superpowers/specs/2026-11-04-status-diagnostics-design.md.
--
-- Until now only results were recorded, so "no result" could mean the cron
-- never fired or every call died at the gateway (Supabase returned 502 for
-- whole link checks and for 26 of a Facebook run's calls on 2026-11-03/04),
-- and a finding window passed when half the accounts *that reported* were
-- read, so missing accounts could never lower it.
--
-- 1. Evidence. Each scheduled run writes one service_health_events row per
--    line before it sends any request: source 'scheduled-run', fingerprint
--    'run_started', metadata {line} for link checks or {line, expected} for
--    finding runs. public.finding_targets() says which accounts a finding line
--    should report, mirroring each cron handler's routing.
-- 2. Status (private.scraper_status_at): finding windows are judged against
--    the expected accounts (pass / partial / fail, or missed when a run
--    started and nothing reported), a new state 'degraded' covers two
--    non-pass windows in a row that aren't both failures, and the rows gain
--    last_run_at, missed_runs and a counts-only `latest`.
-- 3. History (private.scraper_history_at): windows gain expected and missed
--    counts, and results partial (was 'mixed' for links) and missed.
--
-- Failure causes (metadata.read_error, read_error_detail, failure) stay in
-- service_health_events for the admin app; the public functions return counts
-- and times only. Access follows 20261103010000: internal functions live in
-- private, public wrappers are SECURITY DEFINER and granted to every API role.
-- Never REVOKE EXECUTE on a public function from an API role.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Evidence: targets and run-started rows
-- ----------------------------------------------------------------------------

-- Mirrors the routing in retrieve-and-sync-to-db-events (Facebook),
-- retrieve-and-sync-to-db-meetup-events and retrieve-and-sync-to-db-luma-events:
-- change both together. SECURITY INVOKER on purpose: it reads account_secrets,
-- which anon can't, so anon gets "permission denied" while service_role (the
-- admin app) and the status function (run by its SECURITY DEFINER owner) see
-- every row.
CREATE OR REPLACE FUNCTION public.finding_targets()
RETURNS TABLE (source text, line text, account_id text, name text)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
    SELECT a.type AS source,
           CASE WHEN a.type <> 'facebook' THEN 'finding'
                WHEN t.has_token THEN 'partner_pages'
                ELSE 'watched_pages' END AS line,
           a.account_id,
           a.name
    FROM public.accounts a
    CROSS JOIN LATERAL (
        SELECT EXISTS (
            SELECT 1 FROM public.account_secrets s
            WHERE s.account_id = a.account_id
              AND coalesce(s.page_access_token, s.access_token) IS NOT NULL
        ) AS has_token
    ) t
    WHERE a.is_active
      AND a.type IN ('facebook', 'meetup', 'luma')
      AND (
          (a.type = 'facebook' AND t.has_token)
          OR (a.type = 'facebook' AND a.ingest_kind = 'public_scrape' AND nullif(btrim(a.discovery_path), '') IS NOT NULL)
          OR (a.type IN ('meetup', 'luma') AND nullif(btrim(a.discovery_path), '') IS NOT NULL)
      )
$$;

COMMENT ON FUNCTION public.finding_targets() IS
    'The active accounts each finding line should report on (source, line, account_id, name), mirroring the cron handlers'' routing. SECURITY INVOKER: service_role and the status functions only; anon is refused by account_secrets.';

-- One started row per line of a finding cron's source, with how many accounts
-- it should report. Called from the cron command just before the fan-out.
CREATE OR REPLACE FUNCTION private.record_finding_runs(p_type text)
RETURNS void
LANGUAGE sql
SET search_path = public
AS $$
    INSERT INTO public.service_health_events (bucket, source, status, severity, fingerprint, metadata)
    SELECT l.source, 'scheduled-run', 'success', 'info', 'run_started',
           jsonb_build_object('line', l.line, 'expected', count(t.account_id))
    FROM (VALUES ('facebook', 'partner_pages'), ('facebook', 'watched_pages'),
                 ('meetup', 'finding'), ('luma', 'finding')) AS l(source, line)
    LEFT JOIN public.finding_targets() t ON t.source = l.source AND t.line = l.line
    WHERE l.source = p_type
    GROUP BY l.source, l.line
$$;

COMMENT ON FUNCTION private.record_finding_runs(text) IS
    'Records that a finding cron started: one scheduled-run row per line of p_type, with metadata.expected from finding_targets().';

-- One started row per link-checked source.
CREATE OR REPLACE FUNCTION private.record_link_check_runs()
RETURNS void
LANGUAGE sql
SET search_path = public
AS $$
    INSERT INTO public.service_health_events (bucket, source, status, severity, fingerprint, metadata)
    SELECT b.bucket, 'scheduled-run', 'success', 'info', 'run_started', '{"line":"link"}'::jsonb
    FROM (VALUES ('facebook'), ('luma'), ('meetup'), ('eventbrite')) AS b(bucket)
$$;

COMMENT ON FUNCTION private.record_link_check_runs() IS
    'Records that the hourly link checks started: one scheduled-run row per source.';

-- Same as 20261103020000, plus the started rows, in the same transaction as the posts.
CREATE OR REPLACE FUNCTION private.run_link_checks()
RETURNS bigint
LANGUAGE plpgsql
SET search_path = public, net
AS $$
DECLARE
    n bigint := 0;
    rec record;
    auth_token text;
BEGIN
    SELECT value INTO auth_token FROM public.app_secrets WHERE name = 'internal_fn_jwt';
    IF auth_token IS NULL THEN
        RAISE EXCEPTION 'app_secrets.internal_fn_jwt is not set — run: INSERT INTO public.app_secrets(name,value) VALUES(''internal_fn_jwt'',''<JWT>'')';
    END IF;

    PERFORM private.record_link_check_runs();

    FOR rec IN SELECT * FROM private.link_check_requests() LOOP
        PERFORM net.http_post(
            url := 'https://enwcrupzidbcwimyttla.supabase.co/functions/v1/' || rec.fn_name,
            headers := jsonb_build_object(
                'Content-Type', 'application/json',
                'Authorization', 'Bearer ' || auth_token
            ),
            body := rec.body,
            timeout_milliseconds := 60000
        );
        n := n + 1;
    END LOOP;

    RETURN n;
END;
$$;

-- The finding crons record their start, then fan out as before. cron.schedule
-- with an existing job name replaces that job's command.
SELECT cron.schedule(
    'sync-luma-accounts',
    '0 */6 * * *',
    $cron$
    SELECT private.record_finding_runs('luma');
    SELECT public.fan_out_account_syncs(
        'luma',
        'https://enwcrupzidbcwimyttla.supabase.co/functions/v1/retrieve-and-sync-to-db-luma-events'
    );
    $cron$
);

SELECT cron.schedule(
    'sync-meetup-accounts',
    '15 */6 * * *',
    $cron$
    SELECT private.record_finding_runs('meetup');
    SELECT public.fan_out_account_syncs(
        'meetup',
        'https://enwcrupzidbcwimyttla.supabase.co/functions/v1/retrieve-and-sync-to-db-meetup-events'
    );
    $cron$
);

SELECT cron.schedule(
    'sync-fb-accounts',
    '30 */6 * * *',
    $cron$
    SELECT private.record_finding_runs('facebook');
    SELECT public.fan_out_account_syncs(
        'facebook',
        'https://enwcrupzidbcwimyttla.supabase.co/functions/v1/retrieve-and-sync-to-db-events'
    );
    $cron$
);


-- ----------------------------------------------------------------------------
-- 2. Status: partial and missed runs, the degraded state, counts-only latest
-- ----------------------------------------------------------------------------
--
-- Results per line, newest first:
--   link:    pass | fail | no_sample, one per check (as before).
--   finding: one per 6-hour window, judged once it is an hour old, from each
--            account's latest row in it: fail when fewer than half of the
--            pages tried were read, partial when fewer than the expected
--            accounts (or, without a run row, the ones that reported) were
--            read, else pass.
-- Missed runs (a started link check with no result within 10 minutes, or a
-- finding window whose run started and nothing reported) are never results:
-- they are counted in missed_runs, and long silence is still caught by the
-- 3h / 13h staleness limits.
--
-- States, from the two newest results (a lone fail or partial with nothing
-- before it to judge against is set aside, as before):
--   working:  the newest passed, or one non-pass right after a pass (a blip).
--   broken:   two fails in a row.
--   degraded: two non-passes in a row that aren't both fails.
-- since for broken and degraded is the start of the trailing run of non-pass
-- results; noticed_at is when the second result of the trailing fail run
-- (broken) or non-pass run (degraded) became visible, so getting worse
-- alerts again and getting better doesn't.

DROP FUNCTION IF EXISTS public.get_scraper_status();
DROP FUNCTION IF EXISTS private.scraper_status_at(timestamptz);

CREATE FUNCTION private.scraper_status_at(p_now timestamptz)
RETURNS TABLE (
    sort_order      int,
    source          text,
    source_label    text,
    line            text,
    line_label      text,
    state           text,
    since           timestamptz,
    last_worked_at  timestamptz,
    last_checked_at timestamptz,
    noticed_at      timestamptz,
    last_run_at     timestamptz,
    missed_runs     int,
    latest          jsonb
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
WITH catalogue (sort_order, source, source_label, line, line_label, kind) AS (
    VALUES
        (1, 'facebook',   'Facebook',   'link',          'Importing from a link', 'link'),
        (2, 'facebook',   'Facebook',   'partner_pages', 'Partner pages',         'finding'),
        (3, 'facebook',   'Facebook',   'watched_pages', 'Watched pages',         'finding'),
        (4, 'meetup',     'Meetup',     'link',          'Importing from a link', 'link'),
        (5, 'meetup',     'Meetup',     'finding',       'Finding new events',    'finding'),
        (6, 'luma',       'Luma',       'link',          'Importing from a link', 'link'),
        (7, 'luma',       'Luma',       'finding',       'Finding new events',    'finding'),
        (8, 'eventbrite', 'Eventbrite', 'link',          'Importing from a link', 'link'),
        (9, 'eventbrite', 'Eventbrite', 'finding',       'Finding new events',    'not_set_up')
),
lines AS (
    SELECT c.*,
           CASE c.kind WHEN 'link' THEN interval '3 hours' ELSE interval '13 hours' END AS stale_after
    FROM catalogue c
),
recent AS (
    SELECT e.id, e.bucket, e.source, e.status, e.account_id, e.metadata, e.occurred_at
    FROM public.service_health_events e
    -- The catalogue's sources, listed so idx_service_health_events_bucket_time
    -- serves this anon-callable query instead of a scan of the whole table.
    WHERE e.bucket IN ('facebook', 'meetup', 'luma', 'eventbrite')
      AND e.occurred_at > p_now - interval '7 days'
      AND e.occurred_at <= p_now
),
runs AS (
    SELECT l.sort_order,
           l.kind,
           r.occurred_at AS at,
           floor(extract(epoch FROM r.occurred_at) / 21600) AS seq,
           (r.metadata ->> 'expected')::int AS expected
    FROM lines l
    JOIN recent r ON r.bucket = l.source AND r.source = 'scheduled-run' AND r.metadata ->> 'line' = l.line
    WHERE l.kind IN ('link', 'finding')
),
link_rows AS (
    SELECT l.sort_order,
           r.id,
           r.occurred_at AS at,
           CASE r.status WHEN 'success' THEN 'pass' WHEN 'error' THEN 'fail' ELSE 'no_sample' END AS result
    FROM lines l
    JOIN recent r ON r.bucket = l.source AND r.source = 'link-check'
    WHERE l.kind = 'link'
),
link_results AS (
    SELECT lr.sort_order, lr.at, lr.id::numeric AS seq, lr.result, lr.at AS visible_at,
           jsonb_build_object('result', lr.result, 'at', lr.at) AS detail
    FROM link_rows lr
),
-- A started link check with no result within 10 minutes never reported back.
link_missed AS (
    SELECT ru.sort_order, ru.at
    FROM runs ru
    WHERE ru.kind = 'link'
      AND ru.at + interval '10 minutes' <= p_now
      AND NOT EXISTS (
          SELECT 1 FROM link_rows lr
          WHERE lr.sort_order = ru.sort_order AND lr.at >= ru.at AND lr.at <= ru.at + interval '10 minutes'
      )
),
-- Each account's latest row per finding window, once the window is an hour
-- old: every run in it has reported by then (crons start at :00, :15 and :30),
-- and an account a rerun reports twice counts once.
finding_rows AS (
    SELECT DISTINCT ON (l.sort_order, floor(extract(epoch FROM r.occurred_at) / 21600), coalesce(r.account_id, r.id::text))
           l.sort_order,
           floor(extract(epoch FROM r.occurred_at) / 21600) AS seq,
           r.occurred_at,
           coalesce((r.metadata ->> 'page_read')::boolean, false) AS is_read
    FROM lines l
    JOIN recent r
      ON r.bucket = l.source
     AND r.source NOT IN ('link-check', 'scheduled-run')
     AND r.metadata ? 'page_read'
     AND r.metadata ->> 'line' = l.line
    WHERE l.kind = 'finding'
      AND floor(extract(epoch FROM r.occurred_at) / 21600) * 21600 + 3600 <= extract(epoch FROM p_now)
    ORDER BY l.sort_order, floor(extract(epoch FROM r.occurred_at) / 21600), coalesce(r.account_id, r.id::text),
             r.occurred_at DESC, r.id DESC
),
-- How many accounts the window's run should report (max: a cron fired twice
-- doesn't double it). Null for windows from before run rows existed.
window_runs AS (
    SELECT ru.sort_order, ru.seq, max(ru.expected) AS expected, min(ru.at) AS run_at
    FROM runs ru
    WHERE ru.kind = 'finding'
    GROUP BY ru.sort_order, ru.seq
),
-- Each finding window's result as it stood after each moment rows landed in it.
finding_steps AS (
    SELECT s.sort_order, s.seq, s.occurred_at, s.n_rows, s.n_read, wr.expected,
           CASE
               WHEN s.n_read * 2 < s.n_rows                  THEN 'fail'
               WHEN s.n_read < coalesce(wr.expected, s.n_rows) THEN 'partial'
               ELSE 'pass'
           END AS result
    FROM (
        SELECT g.sort_order, g.seq, g.occurred_at,
               sum(g.n_rows) OVER w AS n_rows,
               sum(g.n_read) OVER w AS n_read
        FROM (
            SELECT f.sort_order, f.seq, f.occurred_at,
                   count(*) AS n_rows,
                   count(*) FILTER (WHERE f.is_read) AS n_read
            FROM finding_rows f
            GROUP BY f.sort_order, f.seq, f.occurred_at
        ) g
        WINDOW w AS (PARTITION BY g.sort_order, g.seq ORDER BY g.occurred_at)
    ) s
    LEFT JOIN window_runs wr ON wr.sort_order = s.sort_order AND wr.seq = s.seq
),
finding_changes AS (
    SELECT f.*,
           f.result IS DISTINCT FROM lag(f.result) OVER (PARTITION BY f.sort_order, f.seq ORDER BY f.occurred_at)
               AS changed
    FROM finding_steps f
),
finding_results AS (
    SELECT c.sort_order,
           max(c.occurred_at) AS at,
           c.seq,
           (array_agg(c.result ORDER BY c.occurred_at DESC))[1] AS result,
           -- When the page first showed this window's current result: an hour
           -- after the window opens, or when rows last turned it to this result
           -- if that is later (see 20261103040000).
           greatest(to_timestamp(c.seq * 21600 + 3600),
                    max(c.occurred_at) FILTER (WHERE c.changed)) AS visible_at,
           jsonb_build_object(
               'result',       (array_agg(c.result ORDER BY c.occurred_at DESC))[1],
               'at',           max(c.occurred_at),
               'window_start', to_timestamp(c.seq * 21600),
               'expected',     max(c.expected),
               'reported',     max(c.n_rows),
               'read',         max(c.n_read)
           ) AS detail
    FROM finding_changes c
    GROUP BY c.sort_order, c.seq
),
-- A finding window whose run started, should have reported, and didn't.
finding_missed AS (
    SELECT wr.sort_order, wr.run_at AS at
    FROM window_runs wr
    WHERE wr.seq * 21600 + 3600 <= extract(epoch FROM p_now)
      AND coalesce(wr.expected, 1) > 0
      AND NOT EXISTS (SELECT 1 FROM finding_rows f WHERE f.sort_order = wr.sort_order AND f.seq = wr.seq)
),
results AS (
    SELECT u.*, row_number() OVER (PARTITION BY u.sort_order ORDER BY u.at DESC, u.seq DESC) AS n
    FROM (
        SELECT sort_order, at, seq, result, visible_at, detail FROM link_results
        UNION ALL
        SELECT sort_order, at, seq, result, visible_at, detail FROM finding_results
    ) u
),
-- The newest raw result decides freshness, last_checked_at and latest.
newest AS (
    SELECT r.sort_order,
           max(r.at)     FILTER (WHERE r.n = 1)           AS r1_at,
           max(r.result) FILTER (WHERE r.n = 1)           AS r1,
           max(r.result) FILTER (WHERE r.n = 2)           AS r2,
           (array_agg(r.detail) FILTER (WHERE r.n = 1))[1] AS r1_detail,
           max(r.at)     FILTER (WHERE r.result = 'pass') AS last_worked_at
    FROM results r
    GROUP BY r.sort_order
),
-- A fail or partial is conclusive only after a pass, partial or fail. A lone
-- one after nothing, or after "no test event", is set aside until the next
-- result decides, so it can neither break a line nor make one look healthy.
judged_results AS (
    SELECT r.sort_order, r.at, r.result, r.visible_at,
           row_number() OVER (PARTITION BY r.sort_order ORDER BY r.n) AS n
    FROM results r
    JOIN newest nw ON nw.sort_order = r.sort_order
    WHERE NOT (r.n = 1 AND nw.r1 IN ('fail', 'partial')
               AND coalesce(nw.r2, 'none') NOT IN ('pass', 'partial', 'fail'))
),
latest_two AS (
    SELECT j.sort_order,
           max(j.result) FILTER (WHERE j.n = 1) AS r1,
           max(j.result) FILTER (WHERE j.n = 2) AS r2
    FROM judged_results j
    GROUP BY j.sort_order
),
-- Where each trailing run ends: the newest result outside it.
run_breaks AS (
    SELECT j.sort_order,
           coalesce(min(j.n) FILTER (WHERE j.result NOT IN ('fail', 'partial')), 2147483647) AS bad_end,
           coalesce(min(j.n) FILTER (WHERE j.result <> 'fail'), 2147483647)                  AS fail_end,
           coalesce(min(j.n) FILTER (WHERE j.result <> 'no_sample'), 2147483647)             AS no_sample_end
    FROM judged_results j
    GROUP BY j.sort_order
),
trailing_runs AS (
    SELECT j.sort_order,
           (array_agg(j.at ORDER BY j.at)         FILTER (WHERE j.n < b.bad_end))[1]       AS bad_start,
           (array_agg(j.visible_at ORDER BY j.at) FILTER (WHERE j.n < b.bad_end))[2]       AS bad_second_visible,
           (array_agg(j.visible_at ORDER BY j.at) FILTER (WHERE j.n < b.fail_end))[2]      AS fail_second_visible,
           (array_agg(j.at ORDER BY j.at)         FILTER (WHERE j.n < b.no_sample_end))[1] AS no_sample_start
    FROM judged_results j
    JOIN run_breaks b ON b.sort_order = j.sort_order
    GROUP BY j.sort_order
),
run_activity AS (
    SELECT ru.sort_order, max(ru.at) AS last_run_at FROM runs ru GROUP BY ru.sort_order
),
-- Scheduled runs since the newest result that never reported.
missed AS (
    SELECT m.sort_order, count(*)::int AS n
    FROM (SELECT sort_order, at FROM link_missed UNION ALL SELECT sort_order, at FROM finding_missed) m
    LEFT JOIN newest nw ON nw.sort_order = m.sort_order
    WHERE nw.r1_at IS NULL OR m.at > nw.r1_at
    GROUP BY m.sort_order
),
judged AS (
    SELECT l.*,
           nw.r1_at,
           nw.r1_detail,
           nw.last_worked_at AS worked_at,
           CASE
               WHEN l.kind = 'not_set_up'               THEN 'not_set_up'
               WHEN nw.r1 IS NULL                       THEN 'not_checked'
               WHEN nw.r1_at < p_now - l.stale_after    THEN 'not_checked'
               WHEN lt.r1 IS NULL                       THEN 'unconfirmed'   -- only a lone first fail or partial
               WHEN lt.r1 = 'no_sample'                 THEN 'no_test_event'
               WHEN lt.r1 = 'pass'                      THEN 'working'
               WHEN lt.r2 = 'pass'                      THEN 'working'       -- one blip
               WHEN lt.r1 = 'fail' AND lt.r2 = 'fail'   THEN 'broken'        -- two failures in a row
               ELSE 'degraded'                                               -- two non-passes, not both failures
           END AS state,
           nw.r1_at < p_now - l.stale_after AS is_stale,
           t.bad_start, t.bad_second_visible, t.fail_second_visible, t.no_sample_start,
           ra.last_run_at,
           coalesce(m.n, 0) AS n_missed
    FROM lines l
    LEFT JOIN newest nw       ON nw.sort_order = l.sort_order
    LEFT JOIN latest_two lt   ON lt.sort_order = l.sort_order
    LEFT JOIN trailing_runs t ON t.sort_order = l.sort_order
    LEFT JOIN run_activity ra ON ra.sort_order = l.sort_order
    LEFT JOIN missed m        ON m.sort_order = l.sort_order
)
SELECT j.sort_order,
       j.source,
       j.source_label,
       j.line,
       j.line_label,
       j.state,
       CASE
           WHEN j.state = 'not_checked' AND j.is_stale  THEN j.r1_at + j.stale_after
           WHEN j.state IN ('broken', 'degraded')       THEN j.bad_start
           WHEN j.state = 'no_test_event'               THEN j.no_sample_start
           WHEN j.state = 'unconfirmed'                 THEN j.r1_at
       END AS since,
       CASE WHEN j.state <> 'not_set_up' THEN j.worked_at END AS last_worked_at,
       CASE WHEN j.state <> 'not_set_up' THEN j.r1_at END     AS last_checked_at,
       -- When the current problem became visible on the page, so a stateless
       -- reader can alert once per problem (and again when it gets worse).
       CASE
           WHEN j.state = 'not_checked' AND j.is_stale THEN j.r1_at + j.stale_after
           WHEN j.state = 'no_test_event'             THEN j.no_sample_start
           WHEN j.state = 'broken'                    THEN j.fail_second_visible
           WHEN j.state = 'degraded'                  THEN j.bad_second_visible
       END AS noticed_at,
       CASE WHEN j.state <> 'not_set_up' THEN j.last_run_at END AS last_run_at,
       CASE WHEN j.state <> 'not_set_up' THEN j.n_missed END    AS missed_runs,
       CASE WHEN j.state <> 'not_set_up' THEN j.r1_detail END   AS latest
FROM judged j
ORDER BY j.sort_order
$$;

COMMENT ON FUNCTION private.scraper_status_at(timestamptz) IS
    'Internal: per-line scraper status as of p_now, from service_health_events (link-check rows, cron rows with metadata.page_read, and scheduled-run rows). The public page uses public.get_scraper_status().';

CREATE FUNCTION public.get_scraper_status()
RETURNS TABLE (
    sort_order      int,
    source          text,
    source_label    text,
    line            text,
    line_label      text,
    state           text,
    since           timestamptz,
    last_worked_at  timestamptz,
    last_checked_at timestamptz,
    noticed_at      timestamptz,
    last_run_at     timestamptz,
    missed_runs     int,
    latest          jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT * FROM private.scraper_status_at(now()) s ORDER BY s.sort_order
$$;

COMMENT ON FUNCTION public.get_scraper_status() IS
    'Public, read-only scraper status for /status: one row per line with its state, times, missed runs and the latest result''s counts. Returns no event names, account names, URLs, causes or error text.';

-- Meant for everyone. Never revoke EXECUTE on a public function from an API
-- role (see 20261103010000): keep internal functions in private instead.
GRANT EXECUTE ON FUNCTION public.get_scraper_status() TO anon, authenticated, service_role;


-- ----------------------------------------------------------------------------
-- 3. History: expected and missed counts per window
-- ----------------------------------------------------------------------------
--
-- One row per line and 6-hour UTC window over the last 7 days (28 windows),
-- as in 20261103050000, with the results of section 2:
--   link:    checks = results, passed = success, failed = error (the rest had
--            no test event); expected = checks started in the window (null
--            before run rows), missed = started checks with no result after
--            10 minutes. result: pass, fail, partial (both; was 'mixed'),
--            no_sample, or missed (started, none reported).
--   finding: checks = accounts reported (latest row each), passed = pages
--            read, failed = the rest; expected = the run's expected accounts,
--            missed = expected - reported (both null before run rows).
--            result: pass, partial, fail, or missed. A window shows once it is
--            an hour old.
-- Counts and times only: no event names, account names, URLs or causes.

DROP FUNCTION IF EXISTS public.get_scraper_history();
DROP FUNCTION IF EXISTS private.scraper_history_at(timestamptz);

CREATE FUNCTION private.scraper_history_at(p_now timestamptz)
RETURNS TABLE (
    source       text,
    line         text,
    window_start timestamptz,
    checks       int,
    passed       int,
    failed       int,
    result       text,
    expected     int,
    missed       int
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
WITH recent AS (
    SELECT e.id, e.bucket, e.source, e.status, e.account_id, e.metadata, e.occurred_at,
           CASE WHEN e.source = 'link-check' THEN 'link' ELSE e.metadata ->> 'line' END AS line,
           to_timestamp(floor(extract(epoch FROM e.occurred_at) / 21600) * 21600) AS window_start
    FROM public.service_health_events e
    -- The catalogue's sources, listed so idx_service_health_events_bucket_time
    -- serves this anon-callable query.
    WHERE e.bucket IN ('facebook', 'meetup', 'luma', 'eventbrite')
      -- From the start of the 28th window back (the current window is the 28th).
      AND e.occurred_at >= to_timestamp((floor(extract(epoch FROM p_now) / 21600) - 27) * 21600)
      AND e.occurred_at <= p_now
      AND (e.source IN ('link-check', 'scheduled-run') OR e.metadata ? 'page_read')
),
link_rows AS (
    SELECT * FROM recent WHERE source = 'link-check'
),
link_windows AS (
    SELECT r.bucket AS source, r.window_start,
           count(*)::int                                      AS checks,
           count(*) FILTER (WHERE r.status = 'success')::int  AS passed,
           count(*) FILTER (WHERE r.status = 'error')::int    AS failed
    FROM link_rows r
    GROUP BY r.bucket, r.window_start
),
link_runs AS (
    SELECT ru.bucket AS source, ru.window_start,
           count(*)::int AS scheduled,
           count(*) FILTER (
               WHERE ru.occurred_at + interval '10 minutes' <= p_now
                 AND NOT EXISTS (
                     SELECT 1 FROM link_rows lr
                     WHERE lr.bucket = ru.bucket
                       AND lr.occurred_at >= ru.occurred_at
                       AND lr.occurred_at <= ru.occurred_at + interval '10 minutes'
                 )
           )::int AS missed
    FROM recent ru
    WHERE ru.source = 'scheduled-run' AND ru.line = 'link'
    GROUP BY ru.bucket, ru.window_start
),
link_all AS (
    SELECT coalesce(w.source, ru.source)             AS source,
           'link'::text                              AS line,
           coalesce(w.window_start, ru.window_start) AS window_start,
           coalesce(w.checks, 0)                     AS checks,
           coalesce(w.passed, 0)                     AS passed,
           coalesce(w.failed, 0)                     AS failed,
           ru.scheduled                              AS expected,
           ru.missed                                 AS missed
    FROM link_windows w
    FULL JOIN link_runs ru ON ru.source = w.source AND ru.window_start = w.window_start
),
-- Each account's latest row per finding window (a rerun counts once).
finding_rows AS (
    SELECT DISTINCT ON (r.bucket, r.line, r.window_start, coalesce(r.account_id, r.id::text))
           r.bucket AS source, r.line, r.window_start,
           coalesce((r.metadata ->> 'page_read')::boolean, false) AS is_read
    FROM recent r
    WHERE r.source NOT IN ('link-check', 'scheduled-run') AND r.metadata ? 'page_read'
    ORDER BY r.bucket, r.line, r.window_start, coalesce(r.account_id, r.id::text), r.occurred_at DESC, r.id DESC
),
finding_windows AS (
    SELECT f.source, f.line, f.window_start,
           count(*)::int                         AS checks,
           count(*) FILTER (WHERE f.is_read)::int AS passed
    FROM finding_rows f
    GROUP BY f.source, f.line, f.window_start
),
finding_runs AS (
    SELECT ru.bucket AS source, ru.line, ru.window_start,
           max((ru.metadata ->> 'expected')::int) AS expected
    FROM recent ru
    WHERE ru.source = 'scheduled-run' AND ru.line <> 'link'
    GROUP BY ru.bucket, ru.line, ru.window_start
),
finding_all AS (
    SELECT coalesce(w.source, ru.source)                  AS source,
           coalesce(w.line, ru.line)                      AS line,
           coalesce(w.window_start, ru.window_start)      AS window_start,
           coalesce(w.checks, 0)                          AS checks,
           coalesce(w.passed, 0)                          AS passed,
           coalesce(w.checks, 0) - coalesce(w.passed, 0)  AS failed,
           ru.expected                                    AS expected,
           CASE WHEN ru.expected IS NOT NULL THEN greatest(ru.expected - coalesce(w.checks, 0), 0) END AS missed
    FROM finding_windows w
    FULL JOIN finding_runs ru ON ru.source = w.source AND ru.line = w.line AND ru.window_start = w.window_start
)
SELECT l.source, l.line, l.window_start, l.checks, l.passed, l.failed,
       CASE
           WHEN l.checks = 0                     THEN 'missed'
           WHEN l.failed = 0 AND l.passed > 0    THEN 'pass'
           WHEN l.failed > 0 AND l.passed = 0    THEN 'fail'
           WHEN l.failed > 0                     THEN 'partial'
           ELSE 'no_sample'
       END AS result,
       l.expected, l.missed
FROM link_all l
-- A window whose only started checks are still within their 10 minutes has nothing to show yet.
WHERE l.checks > 0 OR l.missed > 0
UNION ALL
SELECT f.source, f.line, f.window_start, f.checks, f.passed, f.failed,
       CASE
           WHEN f.checks = 0                                THEN 'missed'
           WHEN f.passed * 2 < f.checks                     THEN 'fail'
           WHEN f.passed < coalesce(f.expected, f.checks)   THEN 'partial'
           ELSE 'pass'
       END AS result,
       f.expected, f.missed
FROM finding_all f
-- A finding window counts once it is an hour old, as on the status lines; a
-- run expecting no accounts that reported nothing has nothing to show.
WHERE f.window_start + interval '1 hour' <= p_now
  AND (f.checks > 0 OR f.expected > 0)
ORDER BY 1, 2, 3
$$;

COMMENT ON FUNCTION private.scraper_history_at(timestamptz) IS
    'Internal: per-line results in 6-hour UTC windows over the 7 days before p_now, with expected and missed counts, for the /status bars. The public page uses public.get_scraper_history().';

CREATE FUNCTION public.get_scraper_history()
RETURNS TABLE (
    source       text,
    line         text,
    window_start timestamptz,
    checks       int,
    passed       int,
    failed       int,
    result       text,
    expected     int,
    missed       int
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT * FROM private.scraper_history_at(now())
$$;

COMMENT ON FUNCTION public.get_scraper_history() IS
    'Public, read-only scraper history for the /status bars: per line and 6-hour window, how many checks were expected, ran, passed, failed and never reported. Returns no event names, account names, URLs, causes or error text.';

-- Meant for everyone. Never revoke EXECUTE on a public function from an API
-- role (see 20261103010000): keep internal functions in private instead.
GRANT EXECUTE ON FUNCTION public.get_scraper_history() TO anon, authenticated, service_role;
