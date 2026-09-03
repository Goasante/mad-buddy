-- LOCAL DEVELOPMENT STACK ONLY. Never run against production.
--
-- WHY THIS EXISTS.
-- The repo's migrations did not GRANT table privileges to the Supabase roles,
-- on the assumption that `anon`, `authenticated` and `service_role` receive
-- them from the platform's default privileges, with RLS policies (not grants)
-- narrowing access to the owning user.
--
-- The local Docker stack in this checkout runs Postgres 17.6 while
-- supabase/config.toml declares major_version = 15. On that combination the
-- default ACL for postgres-owned tables in `public` comes out as:
--     anon=Dxtm  authenticated=Dxtm  service_role=Dxtm
-- i.e. TRUNCATE/REFERENCES/TRIGGER/MAINTAIN but NOT SELECT/INSERT/UPDATE/DELETE.
--
-- CORRECTION (2026-09-03). This comment used to conclude that the above was
-- "a property of the local stack, not drift and not a repo defect". That is
-- now known to be wrong, and the error mattered: it explained the symptom away
-- as a local-only quirk, so nothing asserted the grants in migration history.
--
-- A brand-new hosted Supabase project (staging) was given all 124 migrations
-- and came out with service_role holding SELECT on ~31 of 191 public tables;
-- every ordinary service-role API call failed with 42501. That project reports
-- server_version 17.6 -- the same major version blamed here on the local
-- stack. Newly provisioned hosted projects behave the same way; production
-- differs only because it predates this and carries platform default-privilege
-- state that migration history never reproduced.
--
-- The hosted repair now lives in migration
-- 20260903120000_service_role_grant_reproducibility.sql, which asserts
-- service_role authority (and ONLY service_role) so a rebuild from zero
-- produces a usable database.
--
-- The symptom, before this script: every RLS-scoped read fails with
-- "permission denied for table X" (Postgres 42501). In the browser that
-- surfaced as GET /api/notifications 500 on every authenticated page.
--
-- Grants only. No policy, schema or data change: RLS still decides who may see
-- which row, exactly as in production.
--
-- DO NOT COPY THE anon / authenticated LINES BELOW TO A HOSTED PROJECT.
-- They are acceptable here because this stack is disposable and local. On
-- hosted staging, anon holds SELECT on 3 tables and authenticated on 4; that
-- narrowness is the intended design, and broadening it would expose every
-- table to every signed-in user with RLS as the only remaining boundary.
-- The hosted migration deliberately repairs service_role and nothing else,
-- and lib/security/service-role-grants.test.ts fails the build if any
-- migration grants broadly to a browser role.
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
