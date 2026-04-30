-- ============================================================================
-- Realtime Typesense sync — events trigger
-- ============================================================================
--
-- Replaces a pure-nightly Typesense reindex (.github/workflows/sync-typesense.yml)
-- with row-level deltas. Whenever public.events changes, fire a pg_net POST
-- to the sync-event Edge Function with the affected event_id; the function
-- fetches the row + joins, and upserts/deletes the Typesense doc.
--
-- The nightly batch stays as a safety net in case the trigger misses anything
-- (e.g. event_organizers changes via the admin UI without touching events) —
-- but for cron-driven scrapes, search reflects new data within seconds, not
-- hours.
--
-- Reuses app_secrets.internal_fn_jwt for inter-function auth (set during
-- v2 cutover; see 20260430000000_ingest_cron.sql).
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. notify_typesense_event_change — trigger function
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION "public"."notify_typesense_event_change"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, net
AS $$
DECLARE
    v_event_id bigint;
    v_jwt      text;
    v_url      text := 'https://enwcrupzidbcwimyttla.supabase.co/functions/v1/sync-event';
BEGIN
    -- COALESCE handles INSERT/UPDATE (use NEW) and DELETE (use OLD).
    v_event_id := COALESCE(NEW.id, OLD.id);

    SELECT value INTO v_jwt FROM public.app_secrets WHERE name = 'internal_fn_jwt';
    IF v_jwt IS NULL THEN
        -- Don't block the write; just log and skip the sync. The nightly batch
        -- will catch up.
        RAISE WARNING 'app_secrets.internal_fn_jwt not set — skipping Typesense sync for event %', v_event_id;
        RETURN COALESCE(NEW, OLD);
    END IF;

    -- pg_net.http_post is async — returns immediately, queues the request,
    -- delivers in the background. Trigger does not wait on the HTTP roundtrip.
    PERFORM net.http_post(
        url := v_url,
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || v_jwt
        ),
        body := jsonb_build_object('event_id', v_event_id),
        timeout_milliseconds := 10000
    );

    RETURN COALESCE(NEW, OLD);
END;
$$;

COMMENT ON FUNCTION "public"."notify_typesense_event_change"() IS
    'Fires per-row on events INSERT/UPDATE/DELETE; POSTs the event_id to the sync-event Edge Function via pg_net (async). Idempotent on the receiving side.';


-- ----------------------------------------------------------------------------
-- 2. Wire the trigger
-- ----------------------------------------------------------------------------

DROP TRIGGER IF EXISTS "notify_typesense_on_events" ON "public"."events";

CREATE TRIGGER "notify_typesense_on_events"
    AFTER INSERT OR UPDATE OR DELETE ON "public"."events"
    FOR EACH ROW EXECUTE FUNCTION "public"."notify_typesense_event_change"();


-- ----------------------------------------------------------------------------
-- 3. Helper view — last N Typesense sync responses
--
-- Wraps the same net._http_response source as recent_ingest_calls but
-- filters to Typesense calls only by URL match. Useful for diagnosing
-- per-event sync failures without scrolling through cron noise.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE VIEW "public"."recent_typesense_calls" AS
SELECT
    id              AS response_id,
    created         AS response_at,
    status_code,
    error_msg,
    SUBSTRING(content FROM 1 FOR 300) AS body_preview
FROM net._http_response
WHERE created > now() - INTERVAL '24 hours'
  AND id IN (
      SELECT r.id
      FROM net._http_response r
      JOIN net.http_request_queue q ON q.id = r.id
      WHERE q.url LIKE '%/functions/v1/sync-event%'
  )
ORDER BY created DESC;

GRANT SELECT ON "public"."recent_typesense_calls" TO "service_role", "postgres";

COMMENT ON VIEW "public"."recent_typesense_calls" IS
    'Last 24h of HTTP responses from the sync-event Edge Function. Filtered by URL — keeps the diagnostic view focused on Typesense traffic, separate from the per-account ingest fan-out.';


-- ============================================================================
-- End of typesense sync trigger.
--
-- Followups:
--   • Set TYPESENSE_HOST / TYPESENSE_PORT / TYPESENSE_PROTOCOL / TYPESENSE_ADMIN_KEY
--     as Edge Function secrets in the v2 project (see services/typesense
--     README or run: supabase secrets set --env-file <file> --project-ref ...)
--   • Backfill the Typesense index after deploy by triggering the existing
--     workflow:  gh workflow run sync-typesense.yml
--   • If admin-UI organizer/tag changes need to sync without an events row
--     update, add triggers on event_organizers and event_tags using the
--     same notify_typesense_event_change function (extend to read OLD.event_id
--     / NEW.event_id when TG_TABLE_NAME != 'events').
-- ============================================================================
