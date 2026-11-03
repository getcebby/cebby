-- ============================================================================
-- Scraper status: noticed_at is when the page first showed the problem
-- ============================================================================
--
-- /status prints noticed_at as "Noticed:", and the grok-bot routine alerts on
-- lines noticed within the last 2 hours. 20261103010000 set a broken line's
-- noticed_at to its second failed result's row time. For a finding window
-- (6-hour UTC window of cron rows) that is up to an hour before the page shows
-- it, because a window is judged only once it is an hour old: a Meetup window
-- failing at 12:16 UTC first shows as broken at 13:00 but said "noticed 12:16",
-- so a 2-hour reader missed roughly a quarter to a half of new finding problems.
--
-- Each result now carries visible_at: a link check's own time, or for a finding
-- window the later of (window start + 1 hour) and its first row. noticed_at for
-- a broken line uses its second failure's visible_at. since, last_worked_at,
-- last_checked_at and staleness are unchanged. Same signature, so
-- public.get_scraper_status() and its grants are untouched.
-- ============================================================================

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
    last_checked_at timestamptz,
    noticed_at      timestamptz
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
    -- The catalogue's sources, listed so idx_service_health_events_bucket_time
    -- serves this anon-callable query instead of a scan of the whole table.
    WHERE e.bucket IN ('facebook', 'meetup', 'luma', 'eventbrite')
      AND e.occurred_at > p_now - interval '7 days'
      AND e.occurred_at <= p_now
),
link_results AS (
    SELECT l.sort_order,
           r.occurred_at AS at,
           r.id::numeric AS seq,
           CASE r.status WHEN 'success' THEN 'pass' WHEN 'error' THEN 'fail' ELSE 'no_sample' END AS result,
           r.occurred_at AS visible_at
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
           END AS result,
           -- When the page first shows this window's result: an hour after the
           -- window opens (see below), or at its first row if that is later.
           -- Later stragglers don't move it, so a reader alerts once.
           greatest(to_timestamp(floor(extract(epoch FROM min(r.occurred_at)) / 21600) * 21600 + 3600),
                    min(r.occurred_at)) AS visible_at
    FROM lines l
    JOIN recent r
      ON r.bucket = l.source
     AND r.source <> 'link-check'
     AND r.metadata ? 'page_read'
     AND r.metadata ->> 'line' = l.line
    -- A window is judged once it is an hour old: every run in it has reported by
    -- then (crons start at :00, :15 and :30), and its first rows (fast failures)
    -- can't flip a line to broken and back.
    WHERE l.kind = 'finding'
      AND floor(extract(epoch FROM r.occurred_at) / 21600) * 21600 + 3600 <= extract(epoch FROM p_now)
    GROUP BY l.sort_order, floor(extract(epoch FROM r.occurred_at) / 21600)
),
results AS (
    SELECT u.*, row_number() OVER (PARTITION BY u.sort_order ORDER BY u.at DESC, u.seq DESC) AS n
    FROM (SELECT * FROM link_results UNION ALL SELECT * FROM finding_results) u
),
-- The newest raw result decides freshness and last_checked_at.
newest AS (
    SELECT r.sort_order,
           max(r.at)     FILTER (WHERE r.n = 1)           AS r1_at,
           max(r.result) FILTER (WHERE r.n = 1)           AS r1,
           max(r.result) FILTER (WHERE r.n = 2)           AS r2,
           max(r.at)     FILTER (WHERE r.result = 'pass') AS last_worked_at
    FROM results r
    GROUP BY r.sort_order
),
-- A failure is conclusive only right after a pass (one blip: still working) or
-- after another failure (broken). A lone failure after nothing, or after "no
-- test event", is set aside until the next result decides, so it can neither
-- break a line nor make one look healthy.
judged_results AS (
    SELECT r.sort_order, r.at, r.result, r.visible_at,
           row_number() OVER (PARTITION BY r.sort_order ORDER BY r.n) AS n
    FROM results r
    JOIN newest nw ON nw.sort_order = r.sort_order
    WHERE NOT (r.n = 1 AND nw.r1 = 'fail' AND coalesce(nw.r2, 'none') NOT IN ('pass', 'fail'))
),
latest AS (
    SELECT j.sort_order,
           max(j.result) FILTER (WHERE j.n = 1) AS r1,
           max(j.result) FILTER (WHERE j.n = 2) AS r2
    FROM judged_results j
    GROUP BY j.sort_order
),
-- The newest result that differs from the latest one ends the leading run.
run_break AS (
    SELECT j.sort_order, min(j.n) AS n
    FROM judged_results j
    JOIN latest la ON la.sort_order = j.sort_order
    WHERE j.result <> la.r1
    GROUP BY j.sort_order
),
-- When the leading run (results equal to the latest one) began, and its second
-- result: two failures in a row are what make a line broken.
run_start AS (
    SELECT j.sort_order,
           (array_agg(j.at ORDER BY j.at))[1] AS at,
           (array_agg(j.visible_at ORDER BY j.at))[2] AS second_visible_at
    FROM judged_results j
    LEFT JOIN run_break b ON b.sort_order = j.sort_order
    WHERE b.n IS NULL OR j.n < b.n
    GROUP BY j.sort_order
),
judged AS (
    SELECT l.*,
           nw.r1_at,
           nw.last_worked_at AS worked_at,
           CASE
               WHEN l.kind = 'not_set_up'                THEN 'not_set_up'
               WHEN nw.r1 IS NULL                        THEN 'not_checked'
               WHEN nw.r1_at < p_now - l.stale_after     THEN 'not_checked'
               WHEN la.r1 IS NULL                        THEN 'not_checked'   -- only a lone first failure so far
               WHEN la.r1 = 'no_sample'                  THEN 'no_test_event'
               WHEN la.r1 = 'pass'                       THEN 'working'
               WHEN la.r1 = 'fail' AND la.r2 = 'pass'    THEN 'working'       -- one blip
               ELSE 'broken'                                                  -- two failures in a row
           END AS state,
           nw.r1_at < p_now - l.stale_after AS is_stale,
           rs.at AS run_started_at,
           rs.second_visible_at AS run_second_visible_at
    FROM lines l
    LEFT JOIN newest nw ON nw.sort_order = l.sort_order
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
           WHEN j.state = 'not_checked' AND j.is_stale   THEN j.r1_at + j.stale_after
           WHEN j.state IN ('broken', 'no_test_event') THEN j.run_started_at
       END AS since,
       CASE WHEN j.state <> 'not_set_up' THEN j.worked_at END AS last_worked_at,
       CASE WHEN j.state <> 'not_set_up' THEN j.r1_at END     AS last_checked_at,
       -- When the current problem became visible on the page, so a stateless
       -- reader can alert once: broken when its second failure first showed,
       -- the others at their since.
       CASE
           WHEN j.state = 'not_checked' AND j.is_stale THEN j.r1_at + j.stale_after
           WHEN j.state = 'no_test_event'             THEN j.run_started_at
           WHEN j.state = 'broken'                    THEN j.run_second_visible_at
       END AS noticed_at
FROM judged j
ORDER BY j.sort_order
$$;

COMMENT ON FUNCTION private.scraper_status_at(timestamptz) IS
    'Internal: per-line scraper status as of p_now, from service_health_events (link-check rows and cron rows with metadata.page_read). The public page uses public.get_scraper_status().';
