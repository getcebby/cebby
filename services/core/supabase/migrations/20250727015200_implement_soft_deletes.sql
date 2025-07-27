-- Implement soft deletes for important tables

-- Add deleted_at columns to main tables
ALTER TABLE "public"."events" ADD COLUMN "deleted_at" TIMESTAMP WITH TIME ZONE DEFAULT NULL;
ALTER TABLE "public"."accounts" ADD COLUMN "deleted_at" TIMESTAMP WITH TIME ZONE DEFAULT NULL;
ALTER TABLE "public"."locations" ADD COLUMN "deleted_at" TIMESTAMP WITH TIME ZONE DEFAULT NULL;
ALTER TABLE "public"."categories" ADD COLUMN "deleted_at" TIMESTAMP WITH TIME ZONE DEFAULT NULL;
ALTER TABLE "public"."organizers" ADD COLUMN "deleted_at" TIMESTAMP WITH TIME ZONE DEFAULT NULL;
ALTER TABLE "public"."user_profiles" ADD COLUMN "deleted_at" TIMESTAMP WITH TIME ZONE DEFAULT NULL;

-- Add deleted_by columns to track who deleted the record
ALTER TABLE "public"."events" ADD COLUMN "deleted_by" UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE "public"."accounts" ADD COLUMN "deleted_by" UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE "public"."locations" ADD COLUMN "deleted_by" UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE "public"."categories" ADD COLUMN "deleted_by" UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE "public"."organizers" ADD COLUMN "deleted_by" UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE "public"."user_profiles" ADD COLUMN "deleted_by" UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- Create indexes for soft delete queries
CREATE INDEX IF NOT EXISTS "idx_events_deleted_at" ON "public"."events" USING btree ("deleted_at");
CREATE INDEX IF NOT EXISTS "idx_accounts_deleted_at" ON "public"."accounts" USING btree ("deleted_at");
CREATE INDEX IF NOT EXISTS "idx_location_deleted_at" ON "public"."locations" USING btree ("deleted_at");
CREATE INDEX IF NOT EXISTS "idx_category_deleted_at" ON "public"."categories" USING btree ("deleted_at");
CREATE INDEX IF NOT EXISTS "idx_organizers_deleted_at" ON "public"."organizers" USING btree ("deleted_at");
CREATE INDEX IF NOT EXISTS "idx_user_profiles_deleted_at" ON "public"."user_profiles" USING btree ("deleted_at");

-- Create partial indexes for active records (not deleted)
CREATE INDEX IF NOT EXISTS "idx_events_active" ON "public"."events" USING btree ("id", "start_time") 
    WHERE "deleted_at" IS NULL;
CREATE INDEX IF NOT EXISTS "idx_accounts_active" ON "public"."accounts" USING btree ("id", "is_active") 
    WHERE "deleted_at" IS NULL;
CREATE INDEX IF NOT EXISTS "idx_location_active" ON "public"."locations" USING btree ("id", "name") 
    WHERE "deleted_at" IS NULL;
CREATE INDEX IF NOT EXISTS "idx_category_active" ON "public"."categories" USING btree ("id", "name") 
    WHERE "deleted_at" IS NULL;
CREATE INDEX IF NOT EXISTS "idx_organizers_active" ON "public"."organizers" USING btree ("id", "name") 
    WHERE "deleted_at" IS NULL;

-- Generic soft delete function
CREATE OR REPLACE FUNCTION public.soft_delete(
    table_name TEXT,
    record_id BIGINT,
    user_id UUID DEFAULT auth.uid()
)
RETURNS BOOLEAN AS $$
DECLARE
    query TEXT;
    rows_affected INTEGER;
BEGIN
    -- Construct dynamic query for soft delete
    query := format(
        'UPDATE %I SET deleted_at = NOW(), deleted_by = %L WHERE id = %s AND deleted_at IS NULL',
        table_name, user_id, record_id
    );

    EXECUTE query;
    GET DIAGNOSTICS rows_affected = ROW_COUNT;

    RETURN rows_affected > 0;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Generic restore function (undelete)
CREATE OR REPLACE FUNCTION public.restore_deleted(
    table_name TEXT,
    record_id BIGINT
)
RETURNS BOOLEAN AS $$
DECLARE
    query TEXT;
    rows_affected INTEGER;
BEGIN
    -- Construct dynamic query for restore
    query := format(
        'UPDATE %I SET deleted_at = NULL, deleted_by = NULL WHERE id = %s AND deleted_at IS NOT NULL',
        table_name, record_id
    );

    EXECUTE query;
    GET DIAGNOSTICS rows_affected = ROW_COUNT;

    RETURN rows_affected > 0;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to permanently delete old soft-deleted records
CREATE OR REPLACE FUNCTION public.permanent_delete_old_records(
    table_name TEXT,
    days_old INTEGER DEFAULT 90
)
RETURNS INTEGER AS $$
DECLARE
    query TEXT;
    deleted_count INTEGER := 0;
BEGIN
    -- Construct dynamic query for permanent deletion
    query := format(
        'DELETE FROM %I WHERE deleted_at IS NOT NULL AND deleted_at < (NOW() - INTERVAL ''%s days'')',
        table_name, days_old
    );
    
    EXECUTE query;
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create views that automatically exclude soft-deleted records
CREATE OR REPLACE VIEW "public"."events_active" AS
SELECT * FROM "public"."events" WHERE "deleted_at" IS NULL;

CREATE OR REPLACE VIEW "public"."accounts_active" AS
SELECT * FROM "public"."accounts" WHERE "deleted_at" IS NULL;

CREATE OR REPLACE VIEW "public"."location_active" AS
SELECT * FROM "public"."locations" WHERE "deleted_at" IS NULL;

CREATE OR REPLACE VIEW "public"."category_active" AS
SELECT * FROM "public"."categories" WHERE "deleted_at" IS NULL;

CREATE OR REPLACE VIEW "public"."organizers_active" AS
SELECT * FROM "public"."organizers" WHERE "deleted_at" IS NULL;

CREATE OR REPLACE VIEW "public"."user_profiles_active" AS
SELECT * FROM "public"."user_profiles" WHERE "deleted_at" IS NULL;

-- Update RLS policies to exclude soft-deleted records by default
-- Events policies (update existing ones)
DROP POLICY IF EXISTS "Events are viewable by everyone" ON "public"."events";
CREATE POLICY "Events are viewable by everyone" ON "public"."events"
    AS PERMISSIVE FOR SELECT TO public 
    USING ("deleted_at" IS NULL);

-- Location policies
DROP POLICY IF EXISTS "Enable read access for all users" ON "public"."locations";
CREATE POLICY "Enable read access for all users" ON "public"."locations"
    AS PERMISSIVE FOR SELECT TO public 
    USING ("deleted_at" IS NULL);

-- Category policies
DROP POLICY IF EXISTS "Enable read access for all users" ON "public"."categories";
CREATE POLICY "Enable read access for all users" ON "public"."categories"
    AS PERMISSIVE FOR SELECT TO public 
    USING ("deleted_at" IS NULL);

-- Organizers policies
DROP POLICY IF EXISTS "Enable read access for all users" ON "public"."organizers";
CREATE POLICY "Enable read access for all users" ON "public"."organizers"
    AS PERMISSIVE FOR SELECT TO public 
    USING ("deleted_at" IS NULL);

-- User profiles policies
DROP POLICY IF EXISTS "Profiles are viewable by everyone" ON "public"."user_profiles";
CREATE POLICY "Profiles are viewable by everyone" ON "public"."user_profiles"
    AS PERMISSIVE FOR SELECT TO public 
    USING ("deleted_at" IS NULL);

-- Add policies for viewing deleted records (admins only)
CREATE POLICY "Admins can view deleted events" ON "public"."events"
    AS PERMISSIVE FOR SELECT TO authenticated 
    USING (
        "deleted_at" IS NOT NULL AND
        EXISTS (
            SELECT 1 FROM "public"."user_profiles" 
            WHERE id = auth.uid() AND is_admin = true AND deleted_at IS NULL
        )
    );

CREATE POLICY "Admins can view deleted records" ON "public"."locations"
    AS PERMISSIVE FOR SELECT TO authenticated 
    USING (
        "deleted_at" IS NOT NULL AND
        EXISTS (
            SELECT 1 FROM "public"."user_profiles" 
            WHERE id = auth.uid() AND is_admin = true AND deleted_at IS NULL
        )
    );

-- Grant permissions on views
GRANT SELECT ON "public"."events_active" TO "anon";
GRANT SELECT ON "public"."events_active" TO "authenticated";
GRANT SELECT ON "public"."events_active" TO "service_role";

GRANT SELECT ON "public"."accounts_active" TO "authenticated";
GRANT SELECT ON "public"."accounts_active" TO "service_role";

GRANT SELECT ON "public"."location_active" TO "anon";
GRANT SELECT ON "public"."location_active" TO "authenticated";
GRANT SELECT ON "public"."location_active" TO "service_role";

GRANT SELECT ON "public"."category_active" TO "anon";
GRANT SELECT ON "public"."category_active" TO "authenticated";
GRANT SELECT ON "public"."category_active" TO "service_role";

GRANT SELECT ON "public"."organizers_active" TO "anon";
GRANT SELECT ON "public"."organizers_active" TO "authenticated";
GRANT SELECT ON "public"."organizers_active" TO "service_role";

GRANT SELECT ON "public"."user_profiles_active" TO "anon";
GRANT SELECT ON "public"."user_profiles_active" TO "authenticated";
GRANT SELECT ON "public"."user_profiles_active" TO "service_role";

-- Grant execute permissions on functions
GRANT EXECUTE ON FUNCTION public.soft_delete(TEXT, BIGINT, UUID) TO "authenticated";
GRANT EXECUTE ON FUNCTION public.restore_deleted(TEXT, BIGINT) TO "authenticated";
GRANT EXECUTE ON FUNCTION public.permanent_delete_old_records(TEXT, INTEGER) TO "service_role";