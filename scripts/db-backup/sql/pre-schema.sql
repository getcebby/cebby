-- Runs before schema.sql during a restore.
--
-- A fresh Supabase project auto-grants every new table, sequence and function in
-- `public` to anon, authenticated and service_role (ALTER DEFAULT PRIVILEGES FOR ROLE
-- postgres). pg_dump only re-adds the grants production has; it never revokes the
-- automatic ones. Without this file a restore hands anon full access to app_secrets,
-- account_secrets, profiles and every other table production locked down.
--
-- Turning the automatic grants off here makes schema.sql rebuild production's grants
-- exactly. schema.sql then turns them back on at its end (its own ALTER DEFAULT
-- PRIVILEGES lines), so tables added later behave as they do in production.
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated, service_role;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated, service_role;
