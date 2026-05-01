-- ============================================================================
-- Service health buckets
-- ============================================================================
--
-- Cron job success only proves that pg_cron enqueued pg_net HTTP requests.
-- This table lets runtime code record bucketed outcomes so a watchdog can
-- evaluate health by source instead of treating every transient failure as
-- an immediate page.
-- ============================================================================

DROP VIEW IF EXISTS "public"."ingest_health";

CREATE TABLE IF NOT EXISTS "public"."service_health_events" (
    "id"          bigserial PRIMARY KEY,
    "bucket"      text        NOT NULL,
    "source"      text        NOT NULL,
    "status"      text        NOT NULL CHECK ("status" IN ('success', 'warning', 'error')),
    "severity"    text        NOT NULL DEFAULT 'info' CHECK ("severity" IN ('info', 'warning', 'error', 'critical')),
    "fingerprint" text        NOT NULL,
    "account_id"  text,
    "message"     text,
    "metadata"    jsonb       NOT NULL DEFAULT '{}'::jsonb,
    "occurred_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_service_health_events_bucket_time"
    ON "public"."service_health_events" ("bucket", "occurred_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_service_health_events_status_time"
    ON "public"."service_health_events" ("status", "occurred_at" DESC);

ALTER TABLE "public"."service_health_events" ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT ON TABLE "public"."service_health_events" TO "service_role", "postgres";
GRANT USAGE, SELECT ON SEQUENCE "public"."service_health_events_id_seq" TO "service_role", "postgres";
REVOKE ALL ON TABLE "public"."service_health_events" FROM "anon", "authenticated";

-- Seed a short bootstrap grace window. Real Edge Function events replace this
-- signal on the next cron run; if they never arrive, the watchdog turns red
-- after the normal 8h stale threshold.
INSERT INTO "public"."service_health_events" (
    "bucket",
    "source",
    "status",
    "severity",
    "fingerprint",
    "message"
)
VALUES
    ('facebook', 'migration', 'success', 'info', 'watchdog_bootstrap', 'service health bucket created'),
    ('luma',     'migration', 'success', 'info', 'watchdog_bootstrap', 'service health bucket created'),
    ('meetup',   'migration', 'success', 'info', 'watchdog_bootstrap', 'service health bucket created')
ON CONFLICT DO NOTHING;

DROP VIEW IF EXISTS "public"."service_health_bucket_summary";

CREATE VIEW "public"."service_health_bucket_summary" AS
WITH buckets AS (
    SELECT *
    FROM (VALUES
        ('facebook'::text, 8, 10, 3),
        ('luma'::text,     8, 10, 3),
        ('meetup'::text,   8, 10, 3),
        ('typesense'::text, 24, 20, 5)
    ) AS b(bucket, stale_after_hours, error_budget_24h, error_budget_2h)
),
events AS (
    SELECT *
    FROM "public"."service_health_events"
    WHERE occurred_at > now() - INTERVAL '24 hours'
),
summary AS (
    SELECT
        b.bucket,
        b.stale_after_hours,
        b.error_budget_24h,
        b.error_budget_2h,
        max(e.occurred_at) FILTER (WHERE e.status = 'success') AS latest_success_at,
        max(e.occurred_at) FILTER (WHERE e.status IN ('warning', 'error')) AS latest_problem_at,
        max(e.occurred_at) FILTER (WHERE e.status = 'error') AS latest_error_at,
        count(e.*) FILTER (WHERE e.status = 'success') AS successes_24h,
        count(e.*) FILTER (WHERE e.status = 'warning') AS warnings_24h,
        count(e.*) FILTER (WHERE e.status = 'error') AS errors_24h,
        count(e.*) FILTER (
            WHERE e.status = 'error'
              AND e.occurred_at > now() - INTERVAL '2 hours'
        ) AS errors_2h,
        (
            SELECT jsonb_agg(
                jsonb_build_object(
                    'occurred_at', recent.occurred_at,
                    'source', recent.source,
                    'status', recent.status,
                    'severity', recent.severity,
                    'fingerprint', recent.fingerprint,
                    'account_id', recent.account_id,
                    'message', recent.message
                )
                ORDER BY recent.occurred_at DESC
            )
            FROM (
                SELECT *
                FROM events recent
                WHERE recent.bucket = b.bucket
                  AND recent.status IN ('warning', 'error')
                ORDER BY recent.occurred_at DESC
                LIMIT 5
            ) recent
        ) AS recent_problems
    FROM buckets b
    LEFT JOIN events e ON e.bucket = b.bucket
    GROUP BY b.bucket, b.stale_after_hours, b.error_budget_24h, b.error_budget_2h
)
SELECT
    now() AS checked_at,
    bucket,
    stale_after_hours,
    error_budget_24h,
    error_budget_2h,
    latest_success_at,
    latest_problem_at,
    latest_error_at,
    coalesce(successes_24h, 0::bigint) AS successes_24h,
    coalesce(warnings_24h, 0::bigint) AS warnings_24h,
    coalesce(errors_24h, 0::bigint) AS errors_24h,
    coalesce(errors_2h, 0::bigint) AS errors_2h,
    coalesce(recent_problems, '[]'::jsonb) AS recent_problems,
    (
        latest_success_at IS NULL
        OR latest_success_at < now() - make_interval(hours => stale_after_hours)
    ) AS is_stale,
    coalesce(errors_24h, 0::bigint) > error_budget_24h AS exceeds_24h_budget,
    coalesce(errors_2h, 0::bigint) > error_budget_2h AS exceeds_2h_budget,
    (
        latest_error_at IS NOT NULL
        AND (latest_success_at IS NULL OR latest_error_at > latest_success_at)
    ) AS has_unrecovered_error,
    NOT (
        (
            latest_success_at IS NULL
            OR latest_success_at < now() - make_interval(hours => stale_after_hours)
        )
        OR coalesce(errors_24h, 0::bigint) > error_budget_24h
        OR coalesce(errors_2h, 0::bigint) > error_budget_2h
        OR (
            latest_error_at IS NOT NULL
            AND (latest_success_at IS NULL OR latest_error_at > latest_success_at)
        )
    ) AS is_healthy
FROM summary
ORDER BY bucket;

GRANT SELECT ON "public"."service_health_bucket_summary" TO "service_role", "postgres";

COMMENT ON TABLE "public"."service_health_events" IS
    'Bucketed operational health ledger for cron, Edge Functions, search sync, deploys, and future integrations.';

COMMENT ON VIEW "public"."service_health_bucket_summary" IS
    'Per-bucket health budget summary used by the scheduled ingest watchdog workflow.';

-- ============================================================================
-- End service health buckets.
-- ============================================================================
