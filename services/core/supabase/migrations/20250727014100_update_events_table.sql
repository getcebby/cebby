-- Add location_id foreign key to events table
ALTER TABLE "public"."events" 
ADD COLUMN "location_id" BIGINT REFERENCES "public"."locations"("id") ON DELETE SET NULL;

-- Add index for location_id
CREATE INDEX IF NOT EXISTS "idx_events_location" ON "public"."events" USING btree ("location_id");

-- Add updated_at column to events table for better tracking
ALTER TABLE "public"."events" 
ADD COLUMN "updated_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL;

-- Create trigger to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_events_updated_at 
    BEFORE UPDATE ON "public"."events" 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Add similar triggers for other tables
CREATE TRIGGER update_location_updated_at 
    BEFORE UPDATE ON "public"."locations" 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_category_updated_at 
    BEFORE UPDATE ON "public"."categories" 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_organizers_updated_at 
    BEFORE UPDATE ON "public"."organizers" 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_facebook_source_updated_at 
    BEFORE UPDATE ON "public"."facebook_source" 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_meetup_source_updated_at 
    BEFORE UPDATE ON "public"."meetup_source" 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_custom_source_updated_at 
    BEFORE UPDATE ON "public"."custom_source" 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();