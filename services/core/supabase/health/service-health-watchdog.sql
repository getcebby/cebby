DO $$
DECLARE
    bad_count integer;
    bad_summary text;
BEGIN
    SELECT
        count(*),
        string_agg(
            format(
                '%s stale=%s unrecovered_error=%s errors_2h=%s/%s errors_24h=%s/%s latest_success=%s recent=%s',
                bucket,
                is_stale,
                has_unrecovered_error,
                errors_2h,
                error_budget_2h,
                errors_24h,
                error_budget_24h,
                coalesce(latest_success_at::text, 'never'),
                recent_problems::text
            ),
            E'\n'
            ORDER BY bucket
        )
    INTO bad_count, bad_summary
    FROM public.service_health_bucket_summary
    WHERE is_healthy IS DISTINCT FROM true;

    IF bad_count = 0 THEN
        RAISE NOTICE 'service health watchdog healthy';
        RETURN;
    END IF;

    RAISE EXCEPTION 'service health watchdog unhealthy:%', E'\n' || bad_summary;
END $$;
