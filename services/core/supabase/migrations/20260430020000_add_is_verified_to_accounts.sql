-- ============================================================================
-- Add accounts.is_verified — hand-curated partner marker
-- ============================================================================
--
-- The /partners page surfaces the curated whitelist (organizations vetted
-- by an operator), not the raw scrape population. Without an explicit flag
-- it would mix the 16 partners migrated from v1 prod with ~144 cohost
-- accounts auto-discovered during FB/Luma scraping — which dilutes the page.
--
-- The 16 partners migrated from v1 prod each carry a hand-uploaded logo
-- on the v1 Supabase Storage bucket (qkhlgxdtodyyemkarouo). That URL
-- pattern is a one-shot signature we can backfill from. Once
-- migrate-partner-logos-to-r2.ts moves the images, primary_photo no
-- longer matches, but is_verified persists.
--
-- Mirrors venues.is_verified — same shape, same intent at a different level.
-- ============================================================================

ALTER TABLE "public"."accounts"
    ADD COLUMN IF NOT EXISTS "is_verified" boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN "public"."accounts"."is_verified" IS
    'Hand-curated partner marker. True = vetted by admin (logo, name, source links checked). False = auto-discovered via cohost or calendar scrape. Drives /partners page visibility.';

-- Backfill: v1-prod partners are identified by their hand-uploaded logos
-- on the v1 Supabase Storage bucket. Idempotent — re-applying the migration
-- is a no-op once is_verified is already true.
UPDATE "public"."accounts"
   SET "is_verified" = true
 WHERE "primary_photo" LIKE 'https://qkhlgxdtodyyemkarouo.supabase.co/storage/%'
   AND "is_verified" = false;

-- /partners' main query filters on is_verified=true; partial index keeps it
-- cheap as the accounts table grows from cohost discoveries.
CREATE INDEX IF NOT EXISTS "accounts_is_verified_idx"
    ON "public"."accounts" ("name")
    WHERE "is_verified" = true;
