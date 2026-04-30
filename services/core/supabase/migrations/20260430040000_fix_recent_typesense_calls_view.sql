-- ============================================================================
-- Fix recent_typesense_calls view filter
-- ============================================================================
--
-- The original view (20260430030000) filtered by joining net._http_response
-- to net.http_request_queue on URL — but the queue table is purged
-- asynchronously after delivery, so by the time anyone queries the view
-- the queue rows are usually gone and the join returns empty.
--
-- Replace with a content-shape filter: sync-event responses always include
-- {"event_id": ...} as the first key, so we match on body prefix. No join
-- to a transient table required.
-- ============================================================================

DROP VIEW IF EXISTS "public"."recent_typesense_calls";

CREATE VIEW "public"."recent_typesense_calls" AS
SELECT
    id              AS response_id,
    created         AS response_at,
    status_code,
    error_msg,
    SUBSTRING(content FROM 1 FOR 300) AS body_preview
FROM net._http_response
WHERE created > now() - INTERVAL '24 hours'
  AND content LIKE '{"event_id":%'
ORDER BY created DESC;

GRANT SELECT ON "public"."recent_typesense_calls" TO "service_role", "postgres";

COMMENT ON VIEW "public"."recent_typesense_calls" IS
    'Last 24h of HTTP responses from the sync-event Edge Function. Filtered by response body shape (responses begin with {"event_id":}). Replaces the prior URL-join approach which depended on net.http_request_queue retaining processed entries — that table is purged async so the join often returned empty.';
