-- Comprehensive indexing strategy for performance optimization

-- Events table indexes for common queries
CREATE INDEX IF NOT EXISTS "idx_events_start_time_location" ON "public"."events" USING btree ("start_time", "location_id");
CREATE INDEX IF NOT EXISTS "idx_events_end_time" ON "public"."events" USING btree ("end_time");
CREATE INDEX IF NOT EXISTS "idx_events_featured" ON "public"."events" USING btree ("is_featured") WHERE "is_featured" = true;
CREATE INDEX IF NOT EXISTS "idx_events_source" ON "public"."events" USING btree ("source");
CREATE INDEX IF NOT EXISTS "idx_events_created_at" ON "public"."events" USING btree ("created_at");
CREATE INDEX IF NOT EXISTS "idx_events_updated_at" ON "public"."events" USING btree ("updated_at");

-- Composite index for filtering events by time, location and featured
-- CREATE INDEX IF NOT EXISTS "idx_events_active_featured" ON "public"."events" USING btree ("start_time", "location_id", "is_featured") 
--     WHERE "start_time" > NOW();

-- Text search indexes for events
CREATE INDEX IF NOT EXISTS "idx_events_name_gin" ON "public"."events" USING gin (to_tsvector('english', "name"));
CREATE INDEX IF NOT EXISTS "idx_events_description_gin" ON "public"."events" USING gin (to_tsvector('english', "description"));
CREATE INDEX IF NOT EXISTS "idx_events_location_gin" ON "public"."events" USING gin (to_tsvector('english', "location"));

-- Combined text search index
CREATE INDEX IF NOT EXISTS "idx_events_fulltext" ON "public"."events" USING gin (
    to_tsvector('english', COALESCE("name", '') || ' ' || COALESCE("description", '') || ' ' || COALESCE("location", ''))
);

-- Location indexes for geographic queries
CREATE INDEX IF NOT EXISTS "idx_location_name" ON "public"."locations" USING btree ("name");
CREATE INDEX IF NOT EXISTS "idx_location_name_gin" ON "public"."locations" USING gin (to_tsvector('english', "name"));

-- Category indexes
CREATE INDEX IF NOT EXISTS "idx_category_name" ON "public"."categories" USING btree ("name");
CREATE INDEX IF NOT EXISTS "idx_category_hierarchy" ON "public"."categories" USING btree ("parent_id", "name");

-- Organizers indexes
CREATE INDEX IF NOT EXISTS "idx_organizers_name_gin" ON "public"."organizers" USING gin (to_tsvector('english', "name"));

-- Junction table indexes for joins
CREATE INDEX IF NOT EXISTS "idx_event_categories_composite" ON "public"."event_categories" USING btree ("category_id", "event_id");
CREATE INDEX IF NOT EXISTS "idx_event_organizers_composite" ON "public"."event_organizers" USING btree ("organizer_id", "event_id");

-- Event sources indexes
CREATE INDEX IF NOT EXISTS "idx_event_sources_source_id" ON "public"."event_sources" USING btree ("source_id");
CREATE INDEX IF NOT EXISTS "idx_event_sources_composite" ON "public"."event_sources" USING btree ("source_type", "source_id");

-- Account indexes
CREATE INDEX IF NOT EXISTS "idx_accounts_type" ON "public"."accounts" USING btree ("type");
CREATE INDEX IF NOT EXISTS "idx_accounts_active" ON "public"."accounts" USING btree ("is_active") WHERE "is_active" = true;
CREATE INDEX IF NOT EXISTS "idx_accounts_name" ON "public"."accounts" USING btree ("name");

-- Event slugs indexes
CREATE INDEX IF NOT EXISTS "idx_event_slugs_event_id" ON "public"."event_slugs" USING btree ("event_id");

-- User profiles indexes
CREATE INDEX IF NOT EXISTS "idx_user_profiles_email" ON "public"."user_profiles" USING btree ("email");
CREATE INDEX IF NOT EXISTS "idx_user_profiles_admin" ON "public"."user_profiles" USING btree ("is_admin") WHERE "is_admin" = true;

-- Source table indexes
CREATE INDEX IF NOT EXISTS "idx_facebook_source_created" ON "public"."facebook_source" USING btree ("created_at");
CREATE INDEX IF NOT EXISTS "idx_meetup_source_created" ON "public"."meetup_source" USING btree ("created_at");
CREATE INDEX IF NOT EXISTS "idx_eventbrite_source_created" ON "public"."eventbrite_source" USING btree ("created_at");
CREATE INDEX IF NOT EXISTS "idx_custom_source_created" ON "public"."custom_source" USING btree ("created_at");

-- JSON indexes for source details
CREATE INDEX IF NOT EXISTS "idx_facebook_source_detail" ON "public"."facebook_source" USING gin ("event_detail");
CREATE INDEX IF NOT EXISTS "idx_meetup_source_detail" ON "public"."meetup_source" USING gin ("event_detail");
CREATE INDEX IF NOT EXISTS "idx_eventbrite_source_detail" ON "public"."eventbrite_source" USING gin ("event_detail");

-- Partial indexes for active data (without NOW() to avoid immutable function error)
CREATE INDEX IF NOT EXISTS "idx_events_start_time_featured" ON "public"."events" 
USING btree ("start_time", "is_featured") 
WHERE "deleted_at" IS NULL;

CREATE INDEX IF NOT EXISTS "idx_events_time_range" ON "public"."events" 
USING btree ("start_time", "end_time") 
WHERE "deleted_at" IS NULL AND "end_time" IS NOT NULL;

-- Statistics collection for query planning
ANALYZE "public"."events";
ANALYZE "public"."locations";
ANALYZE "public"."categories";
ANALYZE "public"."organizers";
ANALYZE "public"."event_categories";
ANALYZE "public"."event_organizers";
ANALYZE "public"."event_sources";