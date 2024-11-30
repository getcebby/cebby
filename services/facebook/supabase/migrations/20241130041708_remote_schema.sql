

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog";






CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgsodium" WITH SCHEMA "pgsodium";






COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "http" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgjwt" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."get_events_by_location"() RETURNS TABLE("location" "text", "count" bigint)
    LANGUAGE "plpgsql"
    AS $$
begin
  return query
    select 
      events.location,
      count(*)::bigint
    from events
    where 
      location is not null
      and start_time > now()
    group by location
    order by count(*) desc;
end;
$$;


ALTER FUNCTION "public"."get_events_by_location"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."accounts" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "account_id" bigint,
    "type" "text",
    "access_token" "text",
    "name" "text",
    "page_access_token" "text",
    "is_active" boolean DEFAULT false NOT NULL,
    "primary_photo" "text",
    "account_details" "json"
);


ALTER TABLE "public"."accounts" OWNER TO "postgres";


COMMENT ON TABLE "public"."accounts" IS 'Holds accounts for used in scrpting';



COMMENT ON COLUMN "public"."accounts"."page_access_token" IS 'A token that never expires exchanged from each individual access_token';



ALTER TABLE "public"."accounts" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."accounts_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."events" (
    "id" bigint NOT NULL,
    "name" "text",
    "description" "text",
    "start_time" timestamp with time zone,
    "end_time" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "location" "text",
    "source_id" bigint,
    "source" "text",
    "account_id" bigint,
    "cover_photo" "text",
    "is_featured" boolean DEFAULT false NOT NULL,
    "location_details" "json",
    "is_facebook_pages" boolean DEFAULT false,
    "ticket_url" "text"
);


ALTER TABLE "public"."events" OWNER TO "postgres";


COMMENT ON TABLE "public"."events" IS 'All the events from Facebook';



ALTER TABLE "public"."events" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."events_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."facebook_pages" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "username" "text",
    "url" "text",
    "is_active" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."facebook_pages" OWNER TO "postgres";


ALTER TABLE "public"."facebook_pages" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."facebook_pages_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



ALTER TABLE ONLY "public"."accounts"
    ADD CONSTRAINT "accounts_account_id_key" UNIQUE ("account_id");



ALTER TABLE ONLY "public"."accounts"
    ADD CONSTRAINT "accounts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_source_id_key" UNIQUE ("source_id");



ALTER TABLE ONLY "public"."facebook_pages"
    ADD CONSTRAINT "facebook_pages_pkey" PRIMARY KEY ("id");



CREATE INDEX "idx_events_start_time" ON "public"."events" USING "btree" ("start_time");



CREATE OR REPLACE TRIGGER "on_upsert_events_rebuild_pwa" AFTER INSERT ON "public"."events" FOR EACH ROW EXECUTE FUNCTION "supabase_functions"."http_request"('https://api.netlify.com/build_hooks/673540f86de335704ada61b3', 'POST', '{"Content-type":"application/json"}', '{}', '5000');



ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("account_id") ON UPDATE CASCADE;





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";








GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";








































































































































































































































































GRANT ALL ON FUNCTION "public"."get_events_by_location"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_events_by_location"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_events_by_location"() TO "service_role";
























GRANT ALL ON TABLE "public"."accounts" TO "anon";
GRANT ALL ON TABLE "public"."accounts" TO "authenticated";
GRANT ALL ON TABLE "public"."accounts" TO "service_role";



GRANT ALL ON SEQUENCE "public"."accounts_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."accounts_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."accounts_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."events" TO "anon";
GRANT ALL ON TABLE "public"."events" TO "authenticated";
GRANT ALL ON TABLE "public"."events" TO "service_role";



GRANT ALL ON SEQUENCE "public"."events_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."events_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."events_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."facebook_pages" TO "anon";
GRANT ALL ON TABLE "public"."facebook_pages" TO "authenticated";
GRANT ALL ON TABLE "public"."facebook_pages" TO "service_role";



GRANT ALL ON SEQUENCE "public"."facebook_pages_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."facebook_pages_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."facebook_pages_id_seq" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES  TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES  TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES  TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES  TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES  TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES  TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES  TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES  TO "service_role";






























RESET ALL;
