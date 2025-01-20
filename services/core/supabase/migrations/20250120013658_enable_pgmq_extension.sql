create schema if not exists "pgmq";

create extension if not exists "pgmq" with schema "pgmq" version '1.4.4';

do $$
begin
    if not exists (select 1 from pg_type where typname = 'message_record') then
        create type "pgmq"."message_record" as ("msg_id" bigint, "read_ct" integer, "enqueued_at" timestamp with time zone, "vt" timestamp with time zone, "message" jsonb);
    end if;
end
$$;


do $$
begin
    if not exists (select 1 from pg_type where typname = 'metrics_result') then
        create type "pgmq"."metrics_result" as ("queue_name" text, "queue_length" bigint, "newest_msg_age_sec" integer, "oldest_msg_age_sec" integer, "total_messages" bigint, "scrape_time" timestamp with time zone);
    end if;
end
$$;

do $$
begin
    if not exists (select 1 from pg_type where typname = 'queue_record') then
        create type "pgmq"."queue_record" as ("queue_name" character varying, "is_partitioned" boolean, "is_unlogged" boolean, "created_at" timestamp with time zone);
    end if;
end
$$;

grant select on table "pgmq"."meta" to "pg_monitor";


