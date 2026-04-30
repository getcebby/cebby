-- ============================================================================
-- Cebby v2 — ingest cron schedules
-- ============================================================================
--
-- Replaces the function-to-function HTTP fan-out (orchestrator → per-account)
-- with direct pg_cron → pg_net → per-account-fn calls. Each active luma/fb
-- account becomes its own scheduled HTTP POST. pg_net handles the queueing
-- and async delivery; per-account functions process synchronously.
--
-- The orchestrator Edge Functions stay deployed for manual trigger / debug,
-- but cron no longer depends on them.
--
-- After applying this migration, set the internal JWT once:
--
--   INSERT INTO public.app_secrets (name, value, description)
--   VALUES ('internal_fn_jwt', '<legacy-format-anon-key>', 'Bearer used by pg_cron when invoking Edge Functions');
--
-- Get the legacy JWT-format anon key from the project's API Settings page
-- (it's the long eyJ... string, NOT the new sb_publishable_... key).
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Extensions
-- ----------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog";
-- pg_net is pre-installed by Supabase into the `net` schema. We don't pin
-- it to extensions because that conflicts with the existing install.
CREATE EXTENSION IF NOT EXISTS "pg_net";


-- ----------------------------------------------------------------------------
-- 2. app_secrets — internal secrets accessible only by service_role.
--    Used by pg_cron jobs to authenticate to Edge Functions.
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "public"."app_secrets" (
    "name"        text NOT NULL PRIMARY KEY,
    "value"       text NOT NULL,
    "description" text,
    "updated_at"  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE "public"."app_secrets" IS 'Internal secrets keyed by name. RLS-locked so anon/authenticated cannot read; only service_role + postgres can.';

ALTER TABLE "public"."app_secrets" ENABLE ROW LEVEL SECURITY;
-- No anon/authenticated policies = implicit deny for those roles.

GRANT ALL  ON TABLE "public"."app_secrets" TO "service_role", "postgres";
REVOKE ALL ON TABLE "public"."app_secrets" FROM "anon", "authenticated";

DROP TRIGGER IF EXISTS "set_app_secrets_updated_at" ON "public"."app_secrets";
CREATE TRIGGER "set_app_secrets_updated_at"
    BEFORE UPDATE ON "public"."app_secrets"
    FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();


-- ----------------------------------------------------------------------------
-- 3. fan_out_account_syncs — helper called by cron jobs.
--    For each active account of the given type, POSTs the row to the named
--    Edge Function. Async via pg_net (non-blocking). Returns count enqueued.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION "public"."fan_out_account_syncs"(
    p_type text,
    p_fn_url text
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, net
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

    FOR rec IN
        SELECT * FROM public.accounts
        WHERE type = p_type AND is_active = true
    LOOP
        PERFORM net.http_post(
            url := p_fn_url,
            headers := jsonb_build_object(
                'Content-Type', 'application/json',
                'Authorization', 'Bearer ' || auth_token
            ),
            body := to_jsonb(rec),
            timeout_milliseconds := 60000
        );
        n := n + 1;
    END LOOP;

    RETURN n;
END;
$$;

COMMENT ON FUNCTION "public"."fan_out_account_syncs"(text, text) IS 'Fan out HTTP POSTs to an Edge Function for every active account of a given type. Non-blocking — pg_net queues the requests and processes them async. Response status lands in net._http_response.';


-- ----------------------------------------------------------------------------
-- 4. Schedules
-- ----------------------------------------------------------------------------

-- Luma every 6h on the hour (00:00, 06:00, 12:00, 18:00 UTC)
SELECT cron.schedule(
    'sync-luma-accounts',
    '0 */6 * * *',
    $cron$
    SELECT public.fan_out_account_syncs(
        'luma',
        'https://enwcrupzidbcwimyttla.supabase.co/functions/v1/retrieve-and-sync-to-db-luma-events'
    );
    $cron$
);

-- Facebook every 6h offset by 30 min (00:30, 06:30, ...) — staggered so
-- the two sync runs don't both spike R2 / Storage egress at the same minute.
SELECT cron.schedule(
    'sync-fb-accounts',
    '30 */6 * * *',
    $cron$
    SELECT public.fan_out_account_syncs(
        'facebook',
        'https://enwcrupzidbcwimyttla.supabase.co/functions/v1/retrieve-and-sync-to-db-events'
    );
    $cron$
);


-- ----------------------------------------------------------------------------
-- 5. Helper view — check recent ingest HTTP responses
-- ----------------------------------------------------------------------------

-- Wraps net._http_response so we can see what the per-account fns returned.
-- Kept narrow (no join to request queue — column names there vary across
-- Supabase versions). For full request/response correlation, query
-- net._http_response and net.http_request_queue directly.
-- Run: SELECT * FROM public.recent_ingest_calls LIMIT 50;
CREATE OR REPLACE VIEW "public"."recent_ingest_calls" AS
SELECT
    id              AS response_id,
    created         AS response_at,
    status_code,
    error_msg,
    SUBSTRING(content FROM 1 FOR 300) AS body_preview
FROM net._http_response
ORDER BY created DESC;

GRANT SELECT ON "public"."recent_ingest_calls" TO "service_role", "postgres";

COMMENT ON VIEW "public"."recent_ingest_calls" IS 'Most-recent HTTP responses pg_net received from cron-driven Edge Function invocations. Used to diagnose ingest failures. status_code 200 = success; 4xx/5xx = failed scrape.';


-- ============================================================================
-- End of ingest cron schedules.
-- ============================================================================
