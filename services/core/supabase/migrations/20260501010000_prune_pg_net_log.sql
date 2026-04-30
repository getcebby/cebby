-- ============================================================================
-- Prune pg_net's response log to keep the DB lean
-- ============================================================================
--
-- Every cron fan-out + every typesense trigger fire writes a row into
-- `net._http_response`. Quick math at current volume:
--   • cron: ~175 calls × 4 fan-outs/day = ~700 rows/day
--   • typesense trigger: fires per events row change (cron rescrapes touch
--     hundreds of events/day) = ~1-3k rows/day
--   • plus admin scrapes, manual probes, etc.
--
-- We never read responses older than the last hour or two — `recent_ingest_calls`
-- and `recent_typesense_calls` views explicitly window to ≤24h. So holding
-- onto more than that just bloats the DB.
--
-- This schedules an hourly DELETE that keeps a 24h sliding window. Adjust
-- the interval if you ever need longer-tail debugging — e.g. INTERVAL '7 days'
-- if you want a week of cron history.
-- ============================================================================

SELECT cron.schedule(
    'prune-pg-net-response-log',
    '7 * * * *',  -- 7 minutes past every hour, offset from cron fan-outs (which fire on the hour)
    $cron$
    DELETE FROM net._http_response
     WHERE created < now() - INTERVAL '24 hours';
    $cron$
);

-- The request queue can also stagnate if pg_net workers fall behind;
-- prune entries that are clearly abandoned. Default Supabase setup
-- already auto-clears delivered requests, but stale ones (>2h old) are
-- safe to drop — they'll be retried by the cron schedule on its next fire.
SELECT cron.schedule(
    'prune-pg-net-request-queue',
    '12 * * * *',  -- 5 minutes after the response prune
    $cron$
    DELETE FROM net.http_request_queue
     WHERE id IN (
         SELECT id FROM net.http_request_queue
          WHERE timeout_milliseconds < EXTRACT(EPOCH FROM (now() - INTERVAL '2 hours')) * 1000
          LIMIT 1000
     );
    $cron$
);


-- ============================================================================
-- End of pg_net prune.
--
-- To verify it ran:
--   SELECT * FROM cron.job_run_details
--    WHERE jobid IN (
--        SELECT jobid FROM cron.job WHERE jobname LIKE 'prune-pg-net%'
--    )
--    ORDER BY start_time DESC LIMIT 10;
-- ============================================================================
