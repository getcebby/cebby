-- Enhanced full-text search capabilities

-- Create custom text search configuration for events
CREATE TEXT SEARCH CONFIGURATION event_search (COPY = english);

-- Add custom dictionary for event-specific terms
-- ALTER TEXT SEARCH CONFIGURATION event_search ALTER MAPPING FOR asciiword, asciihword, hword_asciipart, hword, hword_part, word WITH simple;

-- Create computed tsvector columns for better search performance
ALTER TABLE "public"."events" ADD COLUMN "search_vector" tsvector;
ALTER TABLE "public"."locations" ADD COLUMN "search_vector" tsvector;
ALTER TABLE "public"."categories" ADD COLUMN "search_vector" tsvector;
ALTER TABLE "public"."organizers" ADD COLUMN "search_vector" tsvector;

-- Create function to update event search vector
CREATE OR REPLACE FUNCTION public.update_event_search_vector()
RETURNS TRIGGER AS $$
BEGIN
    NEW.search_vector := 
        setweight(to_tsvector('event_search', COALESCE(NEW.name, '')), 'A') ||
        setweight(to_tsvector('event_search', COALESCE(NEW.description, '')), 'B') ||
        setweight(to_tsvector('event_search', COALESCE(NEW.location, '')), 'C');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create function to update location search vector
CREATE OR REPLACE FUNCTION public.update_location_search_vector()
RETURNS TRIGGER AS $$
BEGIN
    NEW.search_vector := to_tsvector('event_search', COALESCE(NEW.name, ''));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create function to update category search vector
CREATE OR REPLACE FUNCTION public.update_category_search_vector()
RETURNS TRIGGER AS $$
BEGIN
    NEW.search_vector := to_tsvector('event_search', COALESCE(NEW.name, ''));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create function to update organizer search vector
CREATE OR REPLACE FUNCTION public.update_organizer_search_vector()
RETURNS TRIGGER AS $$
BEGIN
    NEW.search_vector := to_tsvector('event_search', COALESCE(NEW.name, ''));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add triggers to automatically update search vectors
CREATE TRIGGER update_events_search_vector
    BEFORE INSERT OR UPDATE OF name, description, location ON "public"."events"
    FOR EACH ROW EXECUTE FUNCTION public.update_event_search_vector();

CREATE TRIGGER update_location_search_vector
    BEFORE INSERT OR UPDATE OF name ON "public"."locations"
    FOR EACH ROW EXECUTE FUNCTION public.update_location_search_vector();

CREATE TRIGGER update_category_search_vector
    BEFORE INSERT OR UPDATE OF name ON "public"."categories"
    FOR EACH ROW EXECUTE FUNCTION public.update_category_search_vector();

CREATE TRIGGER update_organizer_search_vector
    BEFORE INSERT OR UPDATE OF name ON "public"."organizers"
    FOR EACH ROW EXECUTE FUNCTION public.update_organizer_search_vector();

-- Create GIN indexes for tsvector columns
CREATE INDEX IF NOT EXISTS "idx_events_search_vector" ON "public"."events" USING gin ("search_vector");
CREATE INDEX IF NOT EXISTS "idx_location_search_vector" ON "public"."locations" USING gin ("search_vector");
CREATE INDEX IF NOT EXISTS "idx_category_search_vector" ON "public"."categories" USING gin ("search_vector");
CREATE INDEX IF NOT EXISTS "idx_organizers_search_vector" ON "public"."organizers" USING gin ("search_vector");

-- Update existing records with search vectors
UPDATE "public"."events" SET search_vector = 
    setweight(to_tsvector('event_search', COALESCE(name, '')), 'A') ||
    setweight(to_tsvector('event_search', COALESCE(description, '')), 'B') ||
    setweight(to_tsvector('event_search', COALESCE(location, '')), 'C')
WHERE search_vector IS NULL;

UPDATE "public"."locations" SET search_vector = 
    to_tsvector('event_search', COALESCE(name, ''))
WHERE search_vector IS NULL;

UPDATE "public"."categories" SET search_vector = 
    to_tsvector('event_search', COALESCE(name, ''))
WHERE search_vector IS NULL;

UPDATE "public"."organizers" SET search_vector = 
    to_tsvector('event_search', COALESCE(name, ''))
WHERE search_vector IS NULL;

-- Create advanced search function with ranking
CREATE OR REPLACE FUNCTION public.search_events_fulltext(
    p_search_query TEXT,
    p_location_ids BIGINT[] DEFAULT NULL,
    p_category_ids BIGINT[] DEFAULT NULL,
    p_organizer_ids BIGINT[] DEFAULT NULL,
    p_start_date TIMESTAMP WITH TIME ZONE DEFAULT NULL,
    p_end_date TIMESTAMP WITH TIME ZONE DEFAULT NULL,
    p_is_featured BOOLEAN DEFAULT NULL,
    p_limit INTEGER DEFAULT 20,
    p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
    id BIGINT,
    name TEXT,
    description TEXT,
    start_time TIMESTAMP WITH TIME ZONE,
    end_time TIMESTAMP WITH TIME ZONE,
    location_name TEXT,
    cover_photo TEXT,
    is_featured BOOLEAN,
    ticket_url TEXT,
    search_rank REAL,
    category_names TEXT[],
    organizer_names TEXT[]
) AS $$
DECLARE
    search_ts tsquery;
BEGIN
    -- Parse the search query
    search_ts := plainto_tsquery('event_search', p_search_query);
    
    RETURN QUERY
    SELECT DISTINCT
        e.id,
        e.name,
        e.description,
        e.start_time,
        e.end_time,
        l.name as location_name,
        e.cover_photo,
        e.is_featured,
        e.ticket_url,
        ts_rank(e.search_vector, search_ts) as search_rank,
        ARRAY_AGG(DISTINCT c.name) FILTER (WHERE c.name IS NOT NULL) as category_names,
        ARRAY_AGG(DISTINCT o.name) FILTER (WHERE o.name IS NOT NULL) as organizer_names
    FROM "public"."events" e
    LEFT JOIN "public"."locations" l ON e.location_id = l.location_id AND l.deleted_at IS NULL
    LEFT JOIN "public"."event_categories" ec ON e.id = ec.event_id
    LEFT JOIN "public"."categories" c ON ec.category_id = c.category_id AND c.deleted_at IS NULL
    LEFT JOIN "public"."event_organizers" eo ON e.id = eo.event_id
    LEFT JOIN "public"."organizers" o ON eo.organizer_id = o.organizer_id AND o.deleted_at IS NULL
    WHERE e.deleted_at IS NULL
        AND e.search_vector @@ search_ts
        AND (p_location_ids IS NULL OR e.location_id = ANY(p_location_ids))
        AND (p_category_ids IS NULL OR ec.category_id = ANY(p_category_ids))
        AND (p_organizer_ids IS NULL OR eo.organizer_id = ANY(p_organizer_ids))
        AND (p_start_date IS NULL OR e.start_time >= p_start_date)
        AND (p_end_date IS NULL OR e.start_time <= p_end_date)
        AND (p_is_featured IS NULL OR e.is_featured = p_is_featured)
    GROUP BY e.id, e.name, e.description, e.start_time, e.end_time, l.name, 
             e.cover_photo, e.is_featured, e.ticket_url, e.search_vector
    ORDER BY 
        search_rank DESC,
        CASE WHEN e.is_featured THEN 0 ELSE 1 END,
        e.start_time ASC
    LIMIT p_limit OFFSET p_offset;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Create search suggestions function
CREATE OR REPLACE FUNCTION public.get_search_suggestions(
    p_partial_query TEXT,
    p_limit INTEGER DEFAULT 10
)
RETURNS TABLE (
    suggestion TEXT,
    type TEXT,
    count INTEGER
) AS $$
BEGIN
    RETURN QUERY
    (
        SELECT DISTINCT
            e.name as suggestion,
            'event' as type,
            1 as count
        FROM "public"."events" e
        WHERE e.deleted_at IS NULL 
            AND e.name ILIKE p_partial_query || '%'
        LIMIT p_limit / 4
    )
    UNION ALL
    (
        SELECT DISTINCT
            l.name as suggestion,
            'location' as type,
            COUNT(*)::INTEGER as count
        FROM "public"."locations" l
        JOIN "public"."events" e ON l.location_id = e.location_id
        WHERE l.deleted_at IS NULL 
            AND e.deleted_at IS NULL
            AND l.name ILIKE p_partial_query || '%'
        GROUP BY l.name
        ORDER BY count DESC
        LIMIT p_limit / 4
    )
    UNION ALL
    (
        SELECT DISTINCT
            c.name as suggestion,
            'category' as type,
            COUNT(*)::INTEGER as count
        FROM "public"."categories" c
        JOIN "public"."event_categories" ec ON c.category_id = ec.category_id
        JOIN "public"."events" e ON ec.event_id = e.id
        WHERE c.deleted_at IS NULL 
            AND e.deleted_at IS NULL
            AND c.name ILIKE p_partial_query || '%'
        GROUP BY c.name
        ORDER BY count DESC
        LIMIT p_limit / 4
    )
    UNION ALL
    (
        SELECT DISTINCT
            o.name as suggestion,
            'organizer' as type,
            COUNT(*)::INTEGER as count
        FROM "public"."organizers" o
        JOIN "public"."event_organizers" eo ON o.organizer_id = eo.organizer_id
        JOIN "public"."events" e ON eo.event_id = e.id
        WHERE o.deleted_at IS NULL 
            AND e.deleted_at IS NULL
            AND o.name ILIKE p_partial_query || '%'
        GROUP BY o.name
        ORDER BY count DESC
        LIMIT p_limit / 4
    )
    ORDER BY type, count DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Create function for search highlighting
CREATE OR REPLACE FUNCTION public.highlight_search_results(
    p_text TEXT,
    p_search_query TEXT
)
RETURNS TEXT AS $$
BEGIN
    RETURN ts_headline(
        'event_search',
        p_text,
        plainto_tsquery('event_search', p_search_query),
        'MaxWords=50, MinWords=20, MaxFragments=2, FragmentDelimiter=" ... "'
    );
END;
$$ LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER;

-- Create search analytics table to track popular searches
CREATE TABLE IF NOT EXISTS "public"."search_analytics" (
    "id" BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    "search_query" TEXT NOT NULL,
    "search_type" TEXT DEFAULT 'fulltext' CHECK (search_type IN ('fulltext', 'filter', 'suggestion')),
    "results_count" INTEGER DEFAULT 0,
    "user_id" UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    "ip_address" INET,
    "user_agent" TEXT,
    "created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Create indexes for search analytics
CREATE INDEX IF NOT EXISTS "idx_search_analytics_query" ON "public"."search_analytics" USING btree ("search_query");
CREATE INDEX IF NOT EXISTS "idx_search_analytics_created_at" ON "public"."search_analytics" USING btree ("created_at");
CREATE INDEX IF NOT EXISTS "idx_search_analytics_user" ON "public"."search_analytics" USING btree ("user_id");

-- Enable RLS for search analytics
ALTER TABLE "public"."search_analytics" ENABLE ROW LEVEL SECURITY;

-- Only service role can access search analytics
CREATE POLICY "Service role can manage search analytics" ON "public"."search_analytics"
    AS PERMISSIVE FOR ALL TO service_role USING (true);

-- Function to log search queries
CREATE OR REPLACE FUNCTION public.log_search_query(
    p_search_query TEXT,
    p_search_type TEXT DEFAULT 'fulltext',
    p_results_count INTEGER DEFAULT 0
)
RETURNS VOID AS $$
BEGIN
    INSERT INTO "public"."search_analytics" (
        search_query, search_type, results_count, user_id
    ) VALUES (
        p_search_query, p_search_type, p_results_count, auth.uid()
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant permissions
GRANT ALL ON TABLE "public"."search_analytics" TO "service_role";
GRANT ALL ON SEQUENCE "public"."search_analytics_id_seq" TO "service_role";

GRANT EXECUTE ON FUNCTION public.search_events_fulltext(TEXT, BIGINT[], BIGINT[], BIGINT[], TIMESTAMP WITH TIME ZONE, TIMESTAMP WITH TIME ZONE, BOOLEAN, INTEGER, INTEGER) TO "anon";
GRANT EXECUTE ON FUNCTION public.search_events_fulltext(TEXT, BIGINT[], BIGINT[], BIGINT[], TIMESTAMP WITH TIME ZONE, TIMESTAMP WITH TIME ZONE, BOOLEAN, INTEGER, INTEGER) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.get_search_suggestions(TEXT, INTEGER) TO "anon";
GRANT EXECUTE ON FUNCTION public.get_search_suggestions(TEXT, INTEGER) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.highlight_search_results(TEXT, TEXT) TO "anon";
GRANT EXECUTE ON FUNCTION public.highlight_search_results(TEXT, TEXT) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.log_search_query(TEXT, TEXT, INTEGER) TO "anon";
GRANT EXECUTE ON FUNCTION public.log_search_query(TEXT, TEXT, INTEGER) TO "authenticated";