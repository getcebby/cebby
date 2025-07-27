-- Add comprehensive data validation constraints

-- Events table constraints
ALTER TABLE "public"."events" 
ADD CONSTRAINT "events_name_not_empty" 
CHECK (length(trim("name")) > 0);

ALTER TABLE "public"."events" 
ADD CONSTRAINT "events_valid_times" 
CHECK ("start_time" IS NULL OR "end_time" IS NULL OR "start_time" <= "end_time");

ALTER TABLE "public"."events" 
ADD CONSTRAINT "events_future_start_time" 
CHECK ("start_time" IS NULL OR "start_time" >= '2000-01-01'::timestamp);

ALTER TABLE "public"."events" 
ADD CONSTRAINT "events_valid_source" 
CHECK ("source" IS NULL OR "source" IN ('facebook', 'meetup', 'eventbrite', 'custom', 'manual'));

ALTER TABLE "public"."events" 
ADD CONSTRAINT "events_valid_ticket_url" 
CHECK ("ticket_url" IS NULL OR "ticket_url" ~* '^https?://.*');

ALTER TABLE "public"."events" 
ADD CONSTRAINT "events_valid_cover_photo" 
CHECK ("cover_photo" IS NULL OR "cover_photo" ~* '^https?://.*');

-- Location table constraints
ALTER TABLE "public"."locations" 
ADD CONSTRAINT "location_name_not_empty" 
CHECK (length(trim("name")) > 0);

ALTER TABLE "public"."locations" 
ADD CONSTRAINT "location_valid_latitude" 
CHECK ("latitude" IS NULL OR ("latitude" >= -90 AND "latitude" <= 90));

ALTER TABLE "public"."locations" 
ADD CONSTRAINT "location_valid_longitude" 
CHECK ("longitude" IS NULL OR ("longitude" >= -180 AND "longitude" <= 180));

ALTER TABLE "public"."locations" 
ADD CONSTRAINT "location_coordinates_complete" 
CHECK (
    ("latitude" IS NULL AND "longitude" IS NULL) OR 
    ("latitude" IS NOT NULL AND "longitude" IS NOT NULL)
);

-- Category table constraints
ALTER TABLE "public"."categories" 
ADD CONSTRAINT "category_name_not_empty" 
CHECK (length(trim("name")) > 0);

ALTER TABLE "public"."categories" 
ADD CONSTRAINT "category_no_self_reference" 
CHECK ("parent_id" IS NULL OR "parent_id" != "id");

-- Organizers table constraints
ALTER TABLE "public"."organizers" 
ADD CONSTRAINT "organizers_name_not_empty" 
CHECK (length(trim("name")) > 0);

ALTER TABLE "public"."organizers" 
ADD CONSTRAINT "organizers_valid_photo_url" 
CHECK ("photo_url" IS NULL OR "photo_url" ~* '^https?://.*');

-- Accounts table constraints
ALTER TABLE "public"."accounts" 
ADD CONSTRAINT "accounts_valid_type" 
CHECK ("type" IS NULL OR "type" IN ('facebook_page', 'facebook_account', 'meetup', 'eventbrite', 'manual'));

ALTER TABLE "public"."accounts" 
ADD CONSTRAINT "accounts_valid_photo_url" 
CHECK ("primary_photo" IS NULL OR "primary_photo" ~* '^https?://.*');

ALTER TABLE "public"."accounts" 
ADD CONSTRAINT "accounts_name_not_empty" 
CHECK ("name" IS NULL OR length(trim("name")) > 0);

-- User profiles constraints
ALTER TABLE "public"."user_profiles" 
ADD CONSTRAINT "user_profiles_valid_email" 
CHECK ("email" IS NULL OR "email" ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$');

ALTER TABLE "public"."user_profiles" 
ADD CONSTRAINT "user_profiles_valid_avatar_url" 
CHECK ("avatar_url" IS NULL OR "avatar_url" ~* '^https?://.*');

ALTER TABLE "public"."user_profiles" 
ADD CONSTRAINT "user_profiles_display_name_not_empty" 
CHECK ("display_name" IS NULL OR length(trim("display_name")) > 0);

-- Event sources constraints
ALTER TABLE "public"."event_sources" 
ADD CONSTRAINT "event_sources_valid_source_field" 
CHECK ("source_field" IN ('source_id', 'event_id', 'external_id'));

ALTER TABLE "public"."event_sources" 
ADD CONSTRAINT "event_sources_source_id_not_empty" 
CHECK (length(trim("source_id")) > 0);

-- Source tables constraints
ALTER TABLE "public"."facebook_source" 
ADD CONSTRAINT "facebook_source_valid_type" 
CHECK ("source_type" IN ('page', 'account'));

ALTER TABLE "public"."facebook_source" 
ADD CONSTRAINT "facebook_source_valid_event_link" 
CHECK ("event_link" IS NULL OR "event_link" ~* '^https?://.*facebook\.com.*');

ALTER TABLE "public"."meetup_source" 
ADD CONSTRAINT "meetup_source_valid_event_link" 
CHECK ("event_link" IS NULL OR "event_link" ~* '^https?://.*meetup\.com.*');

ALTER TABLE "public"."eventbrite_source" 
ADD CONSTRAINT "eventbrite_source_valid_event_link" 
CHECK ("event_link" IS NULL OR "event_link" ~* '^https?://.*eventbrite\.com.*');

ALTER TABLE "public"."custom_source" 
ADD CONSTRAINT "custom_source_valid_website_url" 
CHECK ("website_url" IS NULL OR "website_url" ~* '^https?://.*');

-- Audit logs constraints
ALTER TABLE "public"."audit_logs" 
ADD CONSTRAINT "audit_logs_table_name_not_empty" 
CHECK (length(trim("table_name")) > 0);

ALTER TABLE "public"."audit_logs" 
ADD CONSTRAINT "audit_logs_record_id_not_empty" 
CHECK (length(trim("record_id")) > 0);

ALTER TABLE "public"."audit_logs" 
ADD CONSTRAINT "audit_logs_valid_source" 
CHECK ("source" IN ('database', 'api', 'admin', 'system', 'migration'));

-- Create function to validate JSON structure for specific tables
CREATE OR REPLACE FUNCTION public.validate_event_detail_json(detail JSONB, source_type TEXT)
RETURNS BOOLEAN AS $$
BEGIN
    CASE source_type
        WHEN 'facebook_source' THEN
            -- Facebook events should have specific fields
            RETURN (detail ? 'id' AND detail ? 'name');
        WHEN 'meetup_source' THEN
            -- Meetup events should have specific fields
            RETURN (detail ? 'id' AND detail ? 'name');
        WHEN 'eventbrite_source' THEN
            -- Eventbrite events should have specific fields
            RETURN (detail ? 'id' AND detail ? 'name');
        ELSE
            RETURN TRUE; -- Allow any JSON for other sources
    END CASE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Add JSON validation constraints
ALTER TABLE "public"."facebook_source" 
ADD CONSTRAINT "facebook_source_valid_json" 
CHECK ("event_detail" IS NULL OR validate_event_detail_json("event_detail", 'facebook_source'));

ALTER TABLE "public"."meetup_source" 
ADD CONSTRAINT "meetup_source_valid_json" 
CHECK ("event_detail" IS NULL OR validate_event_detail_json("event_detail", 'meetup_source'));

ALTER TABLE "public"."eventbrite_source" 
ADD CONSTRAINT "eventbrite_source_valid_json" 
CHECK ("event_detail" IS NULL OR validate_event_detail_json("event_detail", 'eventbrite_source'));

-- Create function to validate timestamps
CREATE OR REPLACE FUNCTION public.validate_timestamp_order()
RETURNS TRIGGER AS $$
BEGIN
    -- Ensure created_at <= updated_at
    IF NEW.updated_at IS NOT NULL AND NEW.created_at IS NOT NULL THEN
        IF NEW.updated_at < NEW.created_at THEN
            RAISE EXCEPTION 'updated_at cannot be before created_at';
        END IF;
    END IF;
    
    -- Ensure deleted_at >= created_at if both exist
    IF NEW.deleted_at IS NOT NULL AND NEW.created_at IS NOT NULL THEN
        IF NEW.deleted_at < NEW.created_at THEN
            RAISE EXCEPTION 'deleted_at cannot be before created_at';
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add timestamp validation triggers to tables with timestamps
CREATE TRIGGER validate_events_timestamps
    BEFORE INSERT OR UPDATE ON "public"."events"
    FOR EACH ROW EXECUTE FUNCTION public.validate_timestamp_order();

CREATE TRIGGER validate_location_timestamps
    BEFORE INSERT OR UPDATE ON "public"."locations"
    FOR EACH ROW EXECUTE FUNCTION public.validate_timestamp_order();

CREATE TRIGGER validate_category_timestamps
    BEFORE INSERT OR UPDATE ON "public"."categories"
    FOR EACH ROW EXECUTE FUNCTION public.validate_timestamp_order();

CREATE TRIGGER validate_organizers_timestamps
    BEFORE INSERT OR UPDATE ON "public"."organizers"
    FOR EACH ROW EXECUTE FUNCTION public.validate_timestamp_order();

CREATE TRIGGER validate_user_profiles_timestamps
    BEFORE INSERT OR UPDATE ON "public"."user_profiles"
    FOR EACH ROW EXECUTE FUNCTION public.validate_timestamp_order();

-- Function to prevent circular category references
CREATE OR REPLACE FUNCTION public.check_category_hierarchy()
RETURNS TRIGGER AS $$
DECLARE
    parent_id BIGINT;
    current_id BIGINT;
    depth INTEGER := 0;
    max_depth INTEGER := 10; -- Prevent infinite loops
BEGIN
    IF NEW.parent_id IS NULL THEN
        RETURN NEW;
    END IF;
    
    current_id := NEW.parent_id;
    
    WHILE current_id IS NOT NULL AND depth < max_depth LOOP
        IF current_id = NEW.category_id THEN
            RAISE EXCEPTION 'Circular reference detected in category hierarchy';
        END IF;
        
        SELECT parent_id INTO parent_id
        FROM "public"."categories"
        WHERE category_id = current_id AND deleted_at IS NULL;
        
        current_id := parent_id;
        depth := depth + 1;
    END LOOP;
    
    IF depth >= max_depth THEN
        RAISE EXCEPTION 'Category hierarchy too deep (max % levels)', max_depth;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add category hierarchy validation trigger
CREATE TRIGGER validate_category_hierarchy
    BEFORE INSERT OR UPDATE ON "public"."categories"
    FOR EACH ROW EXECUTE FUNCTION public.check_category_hierarchy();

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.validate_event_detail_json(JSONB, TEXT) TO "authenticated";
GRANT EXECUTE ON FUNCTION public.validate_timestamp_order() TO "authenticated";
GRANT EXECUTE ON FUNCTION public.check_category_hierarchy() TO "authenticated";