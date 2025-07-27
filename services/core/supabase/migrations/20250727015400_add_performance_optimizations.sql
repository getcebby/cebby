-- Database performance optimizations

-- Create materialized views for expensive queries
CREATE MATERIALIZED VIEW "public"."event_stats_by_location" AS
SELECT 
    l.id,
    l.name as location_name,
    l.latitude,
    l.longitude,
    COUNT(e.id) as total_events,
    COUNT(CASE WHEN e.start_time > CURRENT_TIMESTAMP THEN 1 END) as upcoming_events,
    COUNT(CASE WHEN e.is_featured = true THEN 1 END) as featured_events,
    MIN(e.start_time) as earliest_event,
    MAX(e.start_time) as latest_event,
    CURRENT_TIMESTAMP as last_updated
FROM "public"."locations" l
LEFT JOIN "public"."events" e ON l.id = e.location_id AND e.deleted_at IS NULL
WHERE l.deleted_at IS NULL
GROUP BY l.id, l.name, l.latitude, l.longitude;

-- Create unique index for materialized view
CREATE UNIQUE INDEX "idx_event_stats_by_location_id" ON "public"."event_stats_by_location" ("id");

-- Create materialized view for category statistics
CREATE MATERIALIZED VIEW "public"."category_stats" AS
SELECT 
    c.id,
    c.name as category_name,
    c.parent_id,
    COUNT(ec.event_id) as total_events,
    COUNT(CASE WHEN e.start_time > CURRENT_TIMESTAMP THEN 1 END) as upcoming_events,
    COUNT(CASE WHEN e.is_featured = true THEN 1 END) as featured_events,
    CURRENT_TIMESTAMP as last_updated
FROM "public"."categories" c
LEFT JOIN "public"."event_categories" ec ON c.id = ec.category_id
LEFT JOIN "public"."events" e ON ec.event_id = e.id AND e.deleted_at IS NULL
WHERE c.deleted_at IS NULL
GROUP BY c.id, c.name, c.parent_id;

-- Create unique index for category stats
CREATE UNIQUE INDEX "idx_category_stats_id" ON "public"."category_stats" ("id");

-- Create materialized view for organizer statistics
CREATE MATERIALIZED VIEW "public"."organizer_stats" AS
SELECT 
    o.id,
    o.name as organizer_name,
    o.photo_url,
    COUNT(eo.event_id) as total_events,
    COUNT(CASE WHEN e.start_time > CURRENT_TIMESTAMP THEN 1 END) as upcoming_events,
    COUNT(CASE WHEN e.is_featured = true THEN 1 END) as featured_events,
    MIN(e.start_time) as earliest_event,
    MAX(e.start_time) as latest_event,
    CURRENT_TIMESTAMP as last_updated
FROM "public"."organizers" o
LEFT JOIN "public"."event_organizers" eo ON o.id = eo.organizer_id
LEFT JOIN "public"."events" e ON eo.event_id = e.id AND e.deleted_at IS NULL
WHERE o.deleted_at IS NULL
GROUP BY o.id, o.name, o.photo_url;

-- Create unique index for organizer stats
CREATE UNIQUE INDEX "idx_organizer_stats_id" ON "public"."organizer_stats" ("id");

-- Function to refresh materialized views
CREATE OR REPLACE FUNCTION public.refresh_stats_views()
RETURNS VOID AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY "public"."event_stats_by_location";
    REFRESH MATERIALIZED VIEW CONCURRENTLY "public"."category_stats";
    REFRESH MATERIALIZED VIEW CONCURRENTLY "public"."organizer_stats";
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function for efficient event search with filters
CREATE OR REPLACE FUNCTION public.search_events(
    p_search_text TEXT DEFAULT NULL,
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
    category_names TEXT[],
    organizer_names TEXT[]
) AS $$
BEGIN
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
        ARRAY_AGG(DISTINCT c.name) FILTER (WHERE c.name IS NOT NULL) as category_names,
        ARRAY_AGG(DISTINCT o.name) FILTER (WHERE o.name IS NOT NULL) as organizer_names
    FROM "public"."events" e
    LEFT JOIN "public"."locations" l ON e.location_id = l.id AND l.deleted_at IS NULL
    LEFT JOIN "public"."event_categories" ec ON e.id = ec.event_id
    LEFT JOIN "public"."categories" c ON ec.category_id = c.id AND c.deleted_at IS NULL
    LEFT JOIN "public"."event_organizers" eo ON e.id = eo.event_id
    LEFT JOIN "public"."organizers" o ON eo.organizer_id = o.id AND o.deleted_at IS NULL
    WHERE e.deleted_at IS NULL
        AND (p_search_text IS NULL OR 
             e.name ILIKE '%' || p_search_text || '%' OR 
             e.description ILIKE '%' || p_search_text || '%' OR
             l.name ILIKE '%' || p_search_text || '%')
        AND (p_location_ids IS NULL OR e.location_id = ANY(p_location_ids))
        AND (p_category_ids IS NULL OR ec.category_id = ANY(p_category_ids))
        AND (p_organizer_ids IS NULL OR eo.organizer_id = ANY(p_organizer_ids))
        AND (p_start_date IS NULL OR e.start_time >= p_start_date)
        AND (p_end_date IS NULL OR e.start_time <= p_end_date)
        AND (p_is_featured IS NULL OR e.is_featured = p_is_featured)
    GROUP BY e.id, e.name, e.description, e.start_time, e.end_time, l.name, e.cover_photo, e.is_featured, e.ticket_url
    ORDER BY 
        CASE WHEN e.is_featured THEN 0 ELSE 1 END,
        e.start_time ASC
    LIMIT p_limit OFFSET p_offset;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Create function for getting event details with all related data
CREATE OR REPLACE FUNCTION public.get_event_details(p_event_id BIGINT)
RETURNS TABLE (
    id BIGINT,
    name TEXT,
    description TEXT,
    start_time TIMESTAMP WITH TIME ZONE,
    end_time TIMESTAMP WITH TIME ZONE,
    location_id BIGINT,
    location_name TEXT,
    latitude DECIMAL,
    longitude DECIMAL,
    cover_photo TEXT,
    is_featured BOOLEAN,
    ticket_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE,
    categories JSONB,
    organizers JSONB,
    sources JSONB
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        e.id,
        e.name,
        e.description,
        e.start_time,
        e.end_time,
        e.location_id,
        l.name as location_name,
        l.latitude,
        l.longitude,
        e.cover_photo,
        e.is_featured,
        e.ticket_url,
        e.created_at,
        e.updated_at,
        COALESCE(
            jsonb_agg(
                DISTINCT jsonb_build_object(
                    'category_id', c.id,
                    'name', c.name,
                    'parent_id', c.parent_id
                )
            ) FILTER (WHERE c.category_id IS NOT NULL), 
            '[]'::jsonb
        ) as categories,
        COALESCE(
            jsonb_agg(
                DISTINCT jsonb_build_object(
                    'organizer_id', o.id,
                    'name', o.name,
                    'photo_url', o.photo_url
                )
            ) FILTER (WHERE o.id IS NOT NULL), 
            '[]'::jsonb
        ) as organizers,
        COALESCE(
            jsonb_agg(
                DISTINCT jsonb_build_object(
                    'source_type', es.source_type,
                    'source_id', es.source_id
                )
            ) FILTER (WHERE es.source_type IS NOT NULL), 
            '[]'::jsonb
        ) as sources
    FROM "public"."events" e
    LEFT JOIN "public"."locations" l ON e.location_id = l.id AND l.deleted_at IS NULL
    LEFT JOIN "public"."event_categories" ec ON e.id = ec.event_id
    LEFT JOIN "public"."categories" c ON ec.category_id = c.id AND c.deleted_at IS NULL
    LEFT JOIN "public"."event_organizers" eo ON e.id = eo.event_id
    LEFT JOIN "public"."organizers" o ON eo.organizer_id = o.id AND o.deleted_at IS NULL
    LEFT JOIN "public"."event_sources" es ON e.id = es.event_id
    WHERE e.id = p_event_id AND e.deleted_at IS NULL
    GROUP BY e.id, e.name, e.description, e.start_time, e.end_time, e.location_id, 
             l.name, l.latitude, l.longitude, e.cover_photo, e.is_featured, e.ticket_url,
             e.created_at, e.updated_at;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Create function for nearby events based on coordinates
CREATE OR REPLACE FUNCTION public.get_nearby_events(
    p_latitude DECIMAL,
    p_longitude DECIMAL,
    p_radius_km DECIMAL DEFAULT 10,
    p_limit INTEGER DEFAULT 20
)
RETURNS TABLE (
    id BIGINT,
    name TEXT,
    start_time TIMESTAMP WITH TIME ZONE,
    location_name TEXT,
    distance_km DECIMAL
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        e.id,
        e.name,
        e.start_time,
        l.name as location_name,
        ROUND(
            (6371 * acos(
                cos(radians(p_latitude)) * 
                cos(radians(l.latitude)) * 
                cos(radians(l.longitude) - radians(p_longitude)) + 
                sin(radians(p_latitude)) * 
                sin(radians(l.latitude))
            ))::numeric, 2
        ) as distance_km
    FROM "public"."events" e
    JOIN "public"."locations" l ON e.location_id = l.id
    WHERE e.deleted_at IS NULL 
        AND l.deleted_at IS NULL
        AND l.latitude IS NOT NULL 
        AND l.longitude IS NOT NULL
        AND e.start_time > CURRENT_TIMESTAMP
        AND (6371 * acos(
            cos(radians(p_latitude)) * 
            cos(radians(l.latitude)) * 
            cos(radians(l.longitude) - radians(p_longitude)) + 
            sin(radians(p_latitude)) * 
            sin(radians(l.latitude))
        )) <= p_radius_km
    ORDER BY distance_km ASC, e.start_time ASC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Enable RLS and grant permissions for materialized views
ALTER MATERIALIZED VIEW "public"."event_stats_by_location" OWNER TO postgres;
ALTER MATERIALIZED VIEW "public"."category_stats" OWNER TO postgres;
ALTER MATERIALIZED VIEW "public"."organizer_stats" OWNER TO postgres;

GRANT SELECT ON "public"."event_stats_by_location" TO "anon";
GRANT SELECT ON "public"."event_stats_by_location" TO "authenticated";
GRANT SELECT ON "public"."event_stats_by_location" TO "service_role";

GRANT SELECT ON "public"."category_stats" TO "anon";
GRANT SELECT ON "public"."category_stats" TO "authenticated";
GRANT SELECT ON "public"."category_stats" TO "service_role";

GRANT SELECT ON "public"."organizer_stats" TO "anon";
GRANT SELECT ON "public"."organizer_stats" TO "authenticated";
GRANT SELECT ON "public"."organizer_stats" TO "service_role";

-- Grant execute permissions on functions
GRANT EXECUTE ON FUNCTION public.refresh_stats_views() TO "service_role";
GRANT EXECUTE ON FUNCTION public.search_events(TEXT, BIGINT[], BIGINT[], BIGINT[], TIMESTAMP WITH TIME ZONE, TIMESTAMP WITH TIME ZONE, BOOLEAN, INTEGER, INTEGER) TO "anon";
GRANT EXECUTE ON FUNCTION public.search_events(TEXT, BIGINT[], BIGINT[], BIGINT[], TIMESTAMP WITH TIME ZONE, TIMESTAMP WITH TIME ZONE, BOOLEAN, INTEGER, INTEGER) TO "authenticated";
GRANT EXECUTE ON FUNCTION public.get_event_details(BIGINT) TO "anon";
GRANT EXECUTE ON FUNCTION public.get_event_details(BIGINT) TO "authenticated";
GRANT EXECUTE ON FUNCTION public.get_nearby_events(DECIMAL, DECIMAL, DECIMAL, INTEGER) TO "anon";
GRANT EXECUTE ON FUNCTION public.get_nearby_events(DECIMAL, DECIMAL, DECIMAL, INTEGER) TO "authenticated";

-- Create a scheduled job to refresh materialized views (if pg_cron is available)
-- This would run every hour to keep stats fresh
-- SELECT cron.schedule('refresh-stats', '0 * * * *', 'SELECT public.refresh_stats_views();');