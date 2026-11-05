-- Applied migration versions. `db dump` leaves supabase_migrations out, so a project
-- restored from a dump needs `supabase migration repair` with these (see README.md).
select version || ' ' || coalesce(name, '') from supabase_migrations.schema_migrations order by version;
