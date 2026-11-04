-- ============================================================================
-- Scraper history: the bars on /status
-- ============================================================================
--
-- /status draws a strip of bars under each check: the last 7 days in 6-hour
-- UTC windows (28 bars, the same windows the finding lines are judged in), so
-- every row shares one time axis.
--
-- private.scraper_history_at returns one row per line and window that has
-- results:
--   - a link line ('link'): that window's hourly link checks. checks = how many
--     ran, passed = success, failed = error (the rest had no test event).
--     result: pass (none failed, at least one passed), fail (none passed, at
--     least one failed), mixed (both), no_sample (only "no test event").
--   - a finding line: that window's account runs. checks = accounts tried,
--     passed = listing pages read, failed = the rest. result: pass when at
--     least half were read, as on the status line. Like there, a window shows
--     only once it is an hour old.
-- Windows without results are left out; the page draws them as "no checks".
--
-- public.get_scraper_history is the API's way in, like get_scraper_status (see
-- 20261103010000 for why internal functions live in the private schema). It
-- returns only counts and times: no event names, account names, URLs or errors.
-- ============================================================================

CREATE OR REPLACE FUNCTION private.scraper_history_at(p_now timestamptz)
RETURNS TABLE (
    source       text,
    line         text,
    window_start timestamptz,
    checks       int,
    passed       int,
    failed       int,
    result       text
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
WITH hits AS (
    SELECT e.bucket AS source,
           CASE WHEN e.source = 'link-check' THEN 'link' ELSE e.metadata ->> 'line' END AS line,
           e.source = 'link-check' AS is_link,
           to_timestamp(floor(extract(epoch FROM e.occurred_at) / 21600) * 21600) AS window_start,
           CASE
               WHEN e.source = 'link-check' THEN e.status = 'success'
               ELSE coalesce((e.metadata ->> 'page_read')::boolean, false)
           END AS ok,
           CASE
               WHEN e.source = 'link-check' THEN e.status = 'error'
               ELSE NOT coalesce((e.metadata ->> 'page_read')::boolean, false)
           END AS bad
    FROM public.service_health_events e
    -- The catalogue's sources, listed so idx_service_health_events_bucket_time
    -- serves this anon-callable query.
    WHERE e.bucket IN ('facebook', 'meetup', 'luma', 'eventbrite')
      -- From the start of the 28th window back (the current window is the 28th).
      AND e.occurred_at >= to_timestamp((floor(extract(epoch FROM p_now) / 21600) - 27) * 21600)
      AND e.occurred_at <= p_now
      AND (e.source = 'link-check' OR e.metadata ? 'page_read')
),
windows AS (
    SELECT h.source, h.line, h.is_link, h.window_start,
           count(*)::int                      AS checks,
           count(*) FILTER (WHERE h.ok)::int  AS passed,
           count(*) FILTER (WHERE h.bad)::int AS failed
    FROM hits h
    -- A finding window counts once it is an hour old, as on the status lines.
    WHERE h.is_link OR h.window_start + interval '1 hour' <= p_now
    GROUP BY h.source, h.line, h.is_link, h.window_start
)
SELECT w.source,
       w.line,
       w.window_start,
       w.checks,
       w.passed,
       w.failed,
       CASE
           WHEN NOT w.is_link THEN CASE WHEN w.passed * 2 >= w.checks THEN 'pass' ELSE 'fail' END
           WHEN w.failed = 0 AND w.passed > 0 THEN 'pass'
           WHEN w.failed > 0 AND w.passed = 0 THEN 'fail'
           WHEN w.failed > 0 THEN 'mixed'
           ELSE 'no_sample'
       END AS result
FROM windows w
ORDER BY w.source, w.line, w.window_start
$$;

COMMENT ON FUNCTION private.scraper_history_at(timestamptz) IS
    'Internal: per-line results in 6-hour UTC windows over the 7 days before p_now, for the /status bars. The public page uses public.get_scraper_history().';

CREATE OR REPLACE FUNCTION public.get_scraper_history()
RETURNS TABLE (
    source       text,
    line         text,
    window_start timestamptz,
    checks       int,
    passed       int,
    failed       int,
    result       text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT * FROM private.scraper_history_at(now())
$$;

COMMENT ON FUNCTION public.get_scraper_history() IS
    'Public, read-only scraper history for the /status bars: per line and 6-hour window, how many checks ran, passed and failed. Returns no event names, account names, URLs or error text.';

-- Meant for everyone. Never revoke EXECUTE on a public function from an API
-- role (see 20261103010000): keep internal functions in private instead.
GRANT EXECUTE ON FUNCTION public.get_scraper_history() TO anon, authenticated, service_role;
