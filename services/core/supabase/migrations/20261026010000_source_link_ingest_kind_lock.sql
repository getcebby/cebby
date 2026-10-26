-- ============================================================================
-- Operator-locked trust tier on source links
-- ============================================================================
--
-- The admin trust badge picker writes event_source_links.ingest_kind, but
-- rescrapes overwrite that column whenever the scraper supplies a tier, so an
-- operator's choice only lasted until the next refresh. ingest_kind_locked
-- marks rows whose tier an operator chose; ingest leaves ingest_kind alone on
-- those rows.
--
-- Internal-only: not granted to anon/authenticated, which only receive the
-- column list from 20260430010000_harden_public_rls.sql.
-- ============================================================================

ALTER TABLE "public"."event_source_links"
    ADD COLUMN IF NOT EXISTS "ingest_kind_locked" boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN "public"."event_source_links"."ingest_kind_locked" IS
    'True when an operator set ingest_kind in admin. Rescrapes keep the operator''s tier.';
