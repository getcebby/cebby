-- ============================================================================
-- Harden public RLS / grants after v2 cutover
-- ============================================================================
--
-- Keep the public directory readable while removing anon/authenticated access to
-- raw scrape payloads and dormant RSVP/profile tables.
-- ============================================================================

-- Sensitive user-data tables: no public policies.
DROP POLICY IF EXISTS "anon_read" ON "public"."profiles";
DROP POLICY IF EXISTS "anon_read" ON "public"."event_registrations";
DROP POLICY IF EXISTS "anon_insert" ON "public"."event_registrations";

REVOKE ALL ON "public"."profiles" FROM "anon", "authenticated";
REVOKE ALL ON "public"."event_registrations" FROM "anon", "authenticated";

-- Source links are public for attribution, but raw payloads are internal-only.
REVOKE SELECT ON "public"."event_source_links" FROM "anon", "authenticated";

GRANT SELECT (
    "id",
    "event_id",
    "source",
    "source_id",
    "url",
    "ingest_kind",
    "scraped_at",
    "created_at",
    "updated_at"
) ON "public"."event_source_links" TO "anon", "authenticated";

REVOKE SELECT ("raw") ON "public"."event_source_links" FROM "anon", "authenticated";

COMMENT ON COLUMN "public"."event_source_links"."raw" IS
    'Internal-only raw scrape payload. Do not grant to anon/authenticated; public clients should select source/url metadata columns explicitly.';

