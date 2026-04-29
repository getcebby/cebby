-- Allows non-numeric IDs from sources like Luma (alphanumeric event slugs)
-- and Meetup (alphanumeric group IDs). Existing Facebook IDs are numeric
-- strings, so they cast cleanly via bigint::text — no data loss.
--
-- The events.account_id FK references accounts.account_id, so both sides must
-- change types in the same migration; FK is dropped and recreated.

ALTER TABLE "public"."events"
    DROP CONSTRAINT IF EXISTS "events_account_id_fkey";

ALTER TABLE "public"."accounts"
    ALTER COLUMN "account_id" TYPE text USING "account_id"::text;

ALTER TABLE "public"."events"
    ALTER COLUMN "source_id" TYPE text USING "source_id"::text;

ALTER TABLE "public"."events"
    ALTER COLUMN "account_id" TYPE text USING "account_id"::text;

ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_account_id_fkey"
    FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("account_id")
    ON UPDATE CASCADE;

COMMENT ON COLUMN "public"."accounts"."account_id" IS 'Provider-specific identifier (FB page ID, Luma calendar slug, Meetup group ID, etc.). Text since this migration to support non-numeric identifiers.';
COMMENT ON COLUMN "public"."events"."source_id" IS 'Provider-specific event identifier (FB event ID, Luma event slug, etc.). Text since this migration.';
