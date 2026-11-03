-- ============================================================================
-- Old watchdog view: ignore link-check rows, and close it to the public key
-- ============================================================================
--
-- Interim until the scraper status page is verified and this view is narrowed
-- to Typesense (plan Task 13). service_health_bucket_summary reads every row
-- of a bucket, and the hourly link checks (20261103020000) now write
-- facebook/luma/meetup rows. Counted here, a single failed check would fail
-- the GitHub watchdog until the next pass (a false alarm that fixes itself),
-- and hourly passes would keep stale or failing crons looking fresh. So the
-- view ignores source = 'link-check'; otherwise it is unchanged from
-- 20260501030000_service_health_buckets.sql.
--
-- anon and authenticated could read this view (it runs with its owner's
-- rights), which exposed recent error messages and account ids through the
-- public API key. Its readers are the admin app (service_role) and the
-- watchdog workflow (postgres). Revoking a relation privilege is safe on the
-- 17.6 image; only denied function calls crash it (see 20261103010000).
-- ============================================================================

CREATE OR REPLACE VIEW "public"."service_health_bucket_summary" AS
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
      -- Hourly link checks feed /status, not this watchdog (see header).
      AND source <> 'link-check'
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

REVOKE ALL ON "public"."service_health_bucket_summary" FROM "anon", "authenticated";
