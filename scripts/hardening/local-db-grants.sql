-- LOCAL DEVELOPMENT STACK ONLY. Never run against production.
--
-- WHY THIS EXISTS.
-- The repo's migrations deliberately do not GRANT table privileges to the
-- Supabase roles: on hosted Supabase, `anon`, `authenticated` and
-- `service_role` receive them from the platform's default privileges, and RLS
-- policies (not grants) are what narrow access to the owning user. That is the
-- correct production design and this script does not change it.
--
-- The local Docker stack in this checkout runs Postgres 17.6 while
-- supabase/config.toml declares major_version = 15. On that combination the
-- default ACL for postgres-owned tables in `public` comes out as:
--     anon=Dxtm  authenticated=Dxtm  service_role=Dxtm
-- i.e. TRUNCATE/REFERENCES/TRIGGER/MAINTAIN but NOT SELECT/INSERT/UPDATE/DELETE.
-- A clean `supabase db reset` reproduces it exactly, so it is a property of the
-- local stack, not drift and not a repo defect.
--
-- The symptom, before this script: every RLS-scoped read fails with
-- "permission denied for table X" (Postgres 42501). In the browser that
-- surfaced as GET /api/notifications 500 on every authenticated page.
--
-- Grants only. No policy, schema or data change: RLS still decides who may see
-- which row, exactly as in production.
grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update, delete on all tables in schema public to service_role;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select on all tables in schema public to anon;
grant usage, select on all sequences in schema public to anon, authenticated, service_role;

alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role, authenticated;
alter default privileges in schema public grant select on tables to anon;
alter default privileges in schema public
  grant usage, select on sequences to anon, authenticated, service_role;
