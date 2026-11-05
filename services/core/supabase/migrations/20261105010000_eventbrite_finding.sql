-- ============================================================================
-- Eventbrite finding new events
-- Spec: docs/superpowers/specs/2026-11-05-eventbrite-finding-design.md
--
-- 1. accounts.is_cebu_based: whether an account is based in Cebu, for the
--    Cebu rule (services/core/supabase/shared/cebu-rule.ts). Only Eventbrite
--    reads it so far; Facebook, Luma and Meetup adopt it in a follow-up.
-- 2. Eventbrite organizers become finding targets, scheduled runs record
--    them, and the status line's kind changes from not_set_up to finding.
--    The three functions are copied from 20261104020000_status_diagnostics.sql
--    with only those changes.
-- 3. The 6-hourly Eventbrite cron at :45 (Luma :00, Meetup :15, Facebook :30).
-- ============================================================================

ALTER TABLE public.accounts ADD COLUMN is_cebu_based boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.accounts.is_cebu_based IS
    'Whether the account is based in Cebu. Its in-person events count only when held in Cebu, whatever this says; its online events count only when this is true. Set by the operator.';

-- Mirrors the routing in retrieve-and-sync-to-db-events (Facebook),
-- retrieve-and-sync-to-db-meetup-events, retrieve-and-sync-to-db-luma-events
-- and retrieve-and-sync-to-db-eventbrite-events: change both together.
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
      AND a.type IN ('facebook', 'meetup', 'luma', 'eventbrite')
      AND (
          (a.type = 'facebook' AND t.has_token)
          OR (a.type = 'facebook' AND a.ingest_kind = 'public_scrape' AND nullif(btrim(a.discovery_path), '') IS NOT NULL)
          OR (a.type IN ('meetup', 'luma') AND nullif(btrim(a.discovery_path), '') IS NOT NULL)
          OR a.type = 'eventbrite'
      )
$$;

CREATE OR REPLACE FUNCTION private.record_finding_runs(p_type text)
RETURNS void
LANGUAGE sql
SET search_path = public
AS $$
    INSERT INTO public.service_health_events (bucket, source, status, severity, fingerprint, metadata)
    SELECT l.source, 'scheduled-run', 'success', 'info', 'run_started',
           jsonb_build_object('line', l.line, 'expected', count(t.account_id))
    FROM (VALUES ('facebook', 'partner_pages'), ('facebook', 'watched_pages'),
                 ('meetup', 'finding'), ('luma', 'finding'), ('eventbrite', 'finding')) AS l(source, line)
    LEFT JOIN public.finding_targets() t ON t.source = l.source AND t.line = l.line
    WHERE l.source = p_type
    GROUP BY l.source, l.line
$$;

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
    noticed_at      timestamptz,
    last_run_at     timestamptz,
    missed_runs     int,
    latest          jsonb,
    unread          text
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
        (9, 'eventbrite', 'Eventbrite', 'finding',       'Finding new events',    'finding')
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
    SELECT lr.sort_order, lr.at, lr.id::numeric AS seq, lr.result, lr.at AS visible_at, lr.at AS onset_visible_at,
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
-- Every account report in a finding window, once the window is an hour old:
-- every run in it has reported by then (crons start at :00, :15 and :30).
finding_rows AS (
    SELECT l.sort_order,
           floor(extract(epoch FROM r.occurred_at) / 21600) AS seq,
           r.occurred_at,
           r.id,
           coalesce(r.account_id, r.id::text) AS account,
           coalesce((r.metadata ->> 'page_read')::boolean, false) AS is_read
    FROM lines l
    JOIN recent r
      ON r.bucket = l.source
     AND r.source NOT IN ('link-check', 'scheduled-run')
     AND r.metadata ? 'page_read'
     AND r.metadata ->> 'line' = l.line
    WHERE l.kind = 'finding'
      AND floor(extract(epoch FROM r.occurred_at) / 21600) * 21600 + 3600 <= extract(epoch FROM p_now)
),
-- What each report changes in its window: an account's first report adds it,
-- and a later one replaces its read result. Summed in time order they give the
-- window as it stood after each moment, with each account's latest report then
-- (a rerun counts once, and a later failure lands when it happened).
finding_deltas AS (
    SELECT f.sort_order, f.seq, f.occurred_at,
           CASE WHEN lag(f.is_read) OVER a IS NULL THEN 1 ELSE 0 END             AS d_rows,
           f.is_read::int - coalesce((lag(f.is_read) OVER a)::int, 0)            AS d_read
    FROM finding_rows f
    WINDOW a AS (PARTITION BY f.sort_order, f.seq, f.account ORDER BY f.occurred_at, f.id)
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
            SELECT d.sort_order, d.seq, d.occurred_at,
                   sum(d.d_rows) AS n_rows,
                   sum(d.d_read) AS n_read
            FROM finding_deltas d
            GROUP BY d.sort_order, d.seq, d.occurred_at
        ) g
        WINDOW w AS (PARTITION BY g.sort_order, g.seq ORDER BY g.occurred_at)
    ) s
    LEFT JOIN window_runs wr ON wr.sort_order = s.sort_order AND wr.seq = s.seq
),
finding_changes AS (
    SELECT f.*,
           f.result IS DISTINCT FROM lag(f.result) OVER (PARTITION BY f.sort_order, f.seq ORDER BY f.occurred_at)
               AS changed,
           -- Between passing and not passing; a flip between fail and partial isn't one.
           (f.result = 'pass') IS DISTINCT FROM lag(f.result = 'pass') OVER (PARTITION BY f.sort_order, f.seq ORDER BY f.occurred_at)
               AS onset_changed
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
           -- When the page first showed it passing or not: degraded keys on
           -- this, so late reports improving a failure to partial (or worsening
           -- partial to fail, which broken catches) don't re-alert a degraded line.
           greatest(to_timestamp(c.seq * 21600 + 3600),
                    max(c.occurred_at) FILTER (WHERE c.onset_changed)) AS onset_visible_at,
           jsonb_build_object(
               'result',       (array_agg(c.result ORDER BY c.occurred_at DESC))[1],
               'at',           max(c.occurred_at),
               'window_start', to_timestamp(c.seq * 21600),
               'expected',     max(c.expected),
               -- The last step's counts: a later report can turn a read into a failure.
               'reported',     (array_agg(c.n_rows ORDER BY c.occurred_at DESC))[1],
               'read',         (array_agg(c.n_read ORDER BY c.occurred_at DESC))[1]
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
        SELECT sort_order, at, seq, result, visible_at, onset_visible_at, detail FROM link_results
        UNION ALL
        SELECT sort_order, at, seq, result, visible_at, onset_visible_at, detail FROM finding_results
    ) u
),
-- The newest raw result decides freshness, last_checked_at and latest.
newest AS (
    SELECT r.sort_order,
           max(r.at)     FILTER (WHERE r.n = 1)           AS r1_at,
           max(r.result) FILTER (WHERE r.n = 1)           AS r1,
           max(r.result) FILTER (WHERE r.n = 2)           AS r2,
           (array_agg(r.detail) FILTER (WHERE r.n = 1))[1] AS r1_detail,
           (array_agg(r.detail) FILTER (WHERE r.n = 2))[1] AS r2_detail,
           max(r.at)     FILTER (WHERE r.result = 'pass') AS last_worked_at
    FROM results r
    GROUP BY r.sort_order
),
-- A fail or partial is conclusive only after a pass, partial or fail. A lone
-- one after nothing, or after "no test event", is set aside until the next
-- result decides, so it can neither break a line nor make one look healthy.
judged_results AS (
    SELECT r.sort_order, r.at, r.result, r.visible_at, r.onset_visible_at,
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
           (array_agg(j.onset_visible_at ORDER BY j.at) FILTER (WHERE j.n < b.bad_end))[2] AS bad_second_visible,
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
           nw.r2_detail,
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
       CASE WHEN j.state <> 'not_set_up' THEN j.r1_detail END   AS latest,
       -- Broken rests on its last two results, so it takes the less severe of
       -- their two words: the page's sentence is then true of both runs.
       CASE
           WHEN j.kind <> 'finding' THEN NULL
           WHEN j.state = 'broken' THEN (ARRAY['none', 'some', 'most', 'all'])[least(
               array_position(ARRAY['none', 'some', 'most', 'all'], private.unread_level(j.r1_detail)),
               array_position(ARRAY['none', 'some', 'most', 'all'], private.unread_level(j.r2_detail)))]
           ELSE private.unread_level(j.r1_detail)
       END AS unread
FROM judged j
ORDER BY j.sort_order
$$;

SELECT cron.schedule(
    'sync-eventbrite-accounts',
    '45 */6 * * *',
    $cron$
    SELECT private.record_finding_runs('eventbrite');
    SELECT public.fan_out_account_syncs(
        'eventbrite',
        'https://enwcrupzidbcwimyttla.supabase.co/functions/v1/retrieve-and-sync-to-db-eventbrite-events'
    );
    $cron$
);
