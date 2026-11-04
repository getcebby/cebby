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
