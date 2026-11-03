-- ============================================================================
-- Scraper status: the rules behind https://www.getcebby.com/status
-- ============================================================================
--
-- Turns service_health_events into one state per status line. Two kinds of
-- rows feed it:
--   * Link checks (source = 'link-check'): the hourly check-only scraper call.
--     status success = pass, error = fail, warning = no usable test event.
--   * Finding runs: the 6-hourly cron rows whose metadata has `page_read`
--     (and `line`). Rows of one 6-hour UTC window form one result, which
--     passes when at least half of its accounts' pages were read.
--
-- States: working, broken (two failed results in a row), not_checked (no
-- result within 3h for link lines, 13h for finding lines), no_test_event,
-- not_set_up. One failure after a pass is a blip and stays working.
--
-- private.scraper_status_at is internal (testable at a fixed time).
-- public.get_scraper_status is the only new function the API can reach, and
-- returns no event, account or error data. anon still cannot read
-- service_health_events.
--
-- Why a private schema instead of REVOKE EXECUTE: on Supabase's Postgres 17.6
-- image (supautils with hint_roles = anon, authenticated, service_role), an
-- API role calling a function it may not execute segfaults the server
-- (reproduced locally on 17.6.1.111; production runs 17.6 with the same
-- hint_roles). PostgREST only exposes public and graphql_public, so functions
-- in private are unreachable over the API and no request can hit that path.
-- Schema-level denials ("permission denied for schema") fail cleanly.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

COMMENT ON SCHEMA private IS
    'Internal functions the API must not reach. Not in PostgREST db_schemas; anon and authenticated have no USAGE.';

CREATE OR REPLACE FUNCTION private.scraper_status_at(p_now timestamptz)
RETURNS TABLE (
    sort_order      int,
    source          text,
    source_label    text,
    line            text,
    line_label      text,
    state           text,
    since           timestamptz,
    last_worked_at  timestamptz,
    last_checked_at timestamptz
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
    SELECT e.id, e.bucket, e.source, e.status, e.metadata, e.occurred_at
    FROM public.service_health_events e
    WHERE e.occurred_at > p_now - interval '7 days'
      AND e.occurred_at <= p_now
),
link_results AS (
    SELECT l.sort_order,
           r.occurred_at AS at,
           r.id::numeric AS seq,
           CASE r.status WHEN 'success' THEN 'pass' WHEN 'error' THEN 'fail' ELSE 'no_sample' END AS result
    FROM lines l
    JOIN recent r ON r.bucket = l.source AND r.source = 'link-check'
    WHERE l.kind = 'link'
),
finding_results AS (
    SELECT l.sort_order,
           max(r.occurred_at) AS at,
           floor(extract(epoch FROM r.occurred_at) / 21600) AS seq,
           CASE
               WHEN count(*) FILTER (WHERE (r.metadata ->> 'page_read')::boolean) * 2 >= count(*) THEN 'pass'
               ELSE 'fail'
           END AS result
    FROM lines l
    JOIN recent r
      ON r.bucket = l.source
     AND r.source <> 'link-check'
     AND r.metadata ? 'page_read'
     AND r.metadata ->> 'line' = l.line
    WHERE l.kind = 'finding'
    GROUP BY l.sort_order, floor(extract(epoch FROM r.occurred_at) / 21600)
),
results AS (
    SELECT u.*, row_number() OVER (PARTITION BY u.sort_order ORDER BY u.at DESC, u.seq DESC) AS n
    FROM (SELECT * FROM link_results UNION ALL SELECT * FROM finding_results) u
),
latest AS (
    SELECT r.sort_order,
           max(r.at)     FILTER (WHERE r.n = 1)          AS r1_at,
           max(r.result) FILTER (WHERE r.n = 1)          AS r1,
           max(r.result) FILTER (WHERE r.n = 2)          AS r2,
           max(r.at)     FILTER (WHERE r.result = 'pass') AS last_worked_at
    FROM results r
    GROUP BY r.sort_order
),
-- The newest result that differs from the latest one ends the leading run.
run_break AS (
    SELECT r.sort_order, min(r.n) AS n
    FROM results r
    JOIN latest la ON la.sort_order = r.sort_order
    WHERE r.result <> la.r1
    GROUP BY r.sort_order
),
-- When the leading run (results equal to the latest one) began.
run_start AS (
    SELECT r.sort_order, min(r.at) AS at
    FROM results r
    LEFT JOIN run_break b ON b.sort_order = r.sort_order
    WHERE b.n IS NULL OR r.n < b.n
    GROUP BY r.sort_order
),
judged AS (
    SELECT l.*,
           la.r1_at,
           la.last_worked_at AS worked_at,
           CASE
               WHEN l.kind = 'not_set_up'                THEN 'not_set_up'
               WHEN la.r1 IS NULL                        THEN 'not_checked'
               WHEN la.r1_at < p_now - l.stale_after     THEN 'not_checked'
               WHEN la.r1 = 'no_sample'                  THEN 'no_test_event'
               WHEN la.r1 = 'pass'                       THEN 'working'
               WHEN la.r1 = 'fail' AND la.r2 = 'fail'    THEN 'broken'
               ELSE 'working'
           END AS state,
           rs.at AS run_started_at
    FROM lines l
    LEFT JOIN latest la ON la.sort_order = l.sort_order
    LEFT JOIN run_start rs ON rs.sort_order = l.sort_order
)
SELECT j.sort_order,
       j.source,
       j.source_label,
       j.line,
       j.line_label,
       j.state,
       CASE
           WHEN j.state = 'not_checked' AND j.r1_at IS NOT NULL THEN j.r1_at + j.stale_after
           WHEN j.state IN ('broken', 'no_test_event')        THEN j.run_started_at
       END AS since,
       CASE WHEN j.state <> 'not_set_up' THEN j.worked_at END AS last_worked_at,
       CASE WHEN j.state <> 'not_set_up' THEN j.r1_at END     AS last_checked_at
FROM judged j
ORDER BY j.sort_order
$$;

COMMENT ON FUNCTION private.scraper_status_at(timestamptz) IS
    'Internal: per-line scraper status as of p_now, from service_health_events (link-check rows and cron rows with metadata.page_read). The public page uses public.get_scraper_status().';

CREATE OR REPLACE FUNCTION public.get_scraper_status()
RETURNS TABLE (
    sort_order      int,
    source          text,
    source_label    text,
    line            text,
    line_label      text,
    state           text,
    since           timestamptz,
    last_worked_at  timestamptz,
    last_checked_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT * FROM private.scraper_status_at(now()) s ORDER BY s.sort_order
$$;

COMMENT ON FUNCTION public.get_scraper_status() IS
    'Public, read-only scraper status for /status: one row per line with its state and times. Returns no event names, account names, URLs or error text.';

-- The wrapper is meant for everyone. Never revoke EXECUTE on a public function
-- from an API role (see the header): keep internal functions in private instead.
GRANT EXECUTE ON FUNCTION public.get_scraper_status() TO anon, authenticated, service_role;
