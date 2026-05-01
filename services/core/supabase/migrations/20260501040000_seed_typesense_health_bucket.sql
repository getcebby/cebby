-- Bootstrap the Typesense health bucket. Realtime Typesense events only emit
-- when event rows change, so give the new watchdog one stale window before
-- requiring a real sync-event success.
INSERT INTO "public"."service_health_events" (
    "bucket",
    "source",
    "status",
    "severity",
    "fingerprint",
    "message"
)
VALUES (
    'typesense',
    'migration',
    'success',
    'info',
    'watchdog_bootstrap',
    'service health bucket created'
);
