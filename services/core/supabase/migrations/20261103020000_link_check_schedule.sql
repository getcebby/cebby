-- ============================================================================
-- Hourly link checks ("importing from a link" on /status)
-- ============================================================================
--
-- Every hour pg_cron posts {"mode":"check"} to each source's *-scraper Edge
-- Function. In check mode the function loads its own test events through
-- public.link_check_samples (as service_role), reads one real event page
-- the way an import does, saves nothing, and records one service_health_events
-- row (source = 'link-check'). private.scraper_status_at reads those rows.
--
-- Samples are picked server-side, not sent in the request: the scrapers accept
-- the public anon key (it is also the cron's bearer), so request-supplied URLs
-- would let anyone fake a failing check.
--
-- Access follows 20261103010000_scraper_status.sql: internal functions live in
-- the private schema; the one public function stays executable by every API
-- role. It reads with the caller's privileges, and anon can already read these
-- columns (all but event_source_links.raw) through the REST API, so it exposes
-- nothing new. Never REVOKE EXECUTE on a public function from an API role.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.link_check_samples(p_source text, p_now timestamptz DEFAULT now())
RETURNS TABLE (url text, expect_location boolean)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
    SELECT s.url,
           (e.format = 'in_person' AND nullif(btrim(e.location), '') IS NOT NULL) AS expect_location
    FROM public.event_source_links s
    JOIN public.events e ON e.id = s.event_id
    WHERE s.source = p_source
      AND s.ingest_kind = 'public_scrape'
      AND s.url IS NOT NULL
      AND e.status = 'published'
      AND (p_source <> 'facebook' OR s.url ~ '^https://(www\.|m\.)?facebook\.com/events/')
    ORDER BY (e.start_time >= p_now) DESC,
             CASE WHEN e.start_time >= p_now THEN e.start_time END ASC,
             CASE WHEN e.start_time < p_now THEN e.start_time END DESC,
             s.id DESC
    LIMIT 3
$$;

COMMENT ON FUNCTION public.link_check_samples(text, timestamptz) IS
    'Test events for a source''s hourly link check: published public_scrape links, upcoming soonest first, then most recent past, at most 3. Called by the *-scraper functions in check mode (service_role); reads tables with the caller''s privileges.';

GRANT EXECUTE ON FUNCTION public.link_check_samples(text, timestamptz) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.link_check_requests()
RETURNS TABLE (fn_name text, body jsonb)
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT r.fn_name, '{"mode":"check"}'::jsonb
    FROM (VALUES (1, 'fb-scraper'), (2, 'luma-scraper'), (3, 'meetup-scraper'), (4, 'eventbrite-scraper'))
        AS r(ord, fn_name)
    ORDER BY r.ord
$$;

COMMENT ON FUNCTION private.link_check_requests() IS
    'The hourly link-check requests: one check-mode POST body per scraper function.';

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

COMMENT ON FUNCTION private.run_link_checks() IS
    'Posts the hourly link-check requests to the production scraper functions via pg_net. Returns the number of requests queued. Run by the check-link-imports cron job.';

-- :40 keeps clear of the 6-hourly ingest fan-outs (:00, :15, :30) and the
-- pg_net prunes (:07, :12).
SELECT cron.schedule(
    'check-link-imports',
    '40 * * * *',
    $cron$ SELECT private.run_link_checks(); $cron$
);
