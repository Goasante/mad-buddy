-- FRESH-DATABASE REPRODUCIBILITY: service_role table and sequence authority.
--
-- WHAT WENT WRONG. Applying all repository migrations to a brand-new hosted
-- Supabase project produced a database the server could not use. Ordinary
-- service-role API calls failed with 42501 "permission denied for table X",
-- and service_role held SELECT on only ~31 of 191 public tables.
--
-- WHY. Migrations run as `postgres`, and on a freshly provisioned project the
-- default ACL for postgres-owned tables in `public` is:
--
--     anon=Dxtm  authenticated=Dxtm  service_role=Dxtm
--
-- i.e. TRUNCATE/REFERENCES/TRIGGER/MAINTAIN but NOT SELECT/INSERT/UPDATE/
-- DELETE. Verified on the new project via pg_default_acl, which carries two
-- competing entries for tables: one from `supabase_admin` granting full DML,
-- and one from `postgres` granting only Dxtm. Tables created by a migration
-- take the `postgres` one.
--
-- The repository has never asserted these grants. Across all 124 prior
-- migrations there is no ALTER DEFAULT PRIVILEGES and no GRANT ... ON ALL
-- TABLES; only ten individual tables are granted to service_role explicitly
-- (premium trials, experiments, scheduler_incidents), which is exactly why a
-- small minority of tables worked and the rest did not.
--
-- WHY PRODUCTION IS UNAFFECTED. The production project predates this and
-- carries platform default-privilege state granting DML on newly created
-- tables. It has been operating correctly the whole time, which is precisely
-- what hid the defect: the schema was reproducible, the ACLs were not. The
-- repository already documents a sibling case of this in
-- 20260830160000_upfor_claim_grant_hardening.sql, where production's default
-- privileges silently granted EXECUTE that the migration believed it had
-- revoked. Same class of problem, opposite direction.
--
-- NOTE ON scripts/hardening/local-db-grants.sql. That script describes this
-- exact ACL shape but attributes it to the LOCAL Docker stack running
-- Postgres 17 while config.toml declares 15, and concludes it is "a property
-- of the local stack, not drift and not a repo defect". The new hosted
-- project reports server_version 17.6, so this is not local-only: newly
-- provisioned hosted projects now behave the same way. That comment is stale
-- and is corrected in this change.
--
-- SCOPE. service_role ONLY. service_role is the trusted backend identity used
-- by server actions, workers and cron; it is never exposed to a browser, and
-- RLS is not what constrains it. The browser roles are deliberately NOT
-- touched here: on this database anon holds SELECT on 3 tables and
-- authenticated on 4, and that narrowness is the intended design. Widening
-- them is how a grant repair turns into a data-exposure incident, so this
-- migration must never grow an anon/authenticated clause. (The local-only
-- script above does grant broadly to those roles; that is acceptable for a
-- disposable Docker stack and must not be copied to a hosted project.)
--
-- IDEMPOTENT. GRANT and ALTER DEFAULT PRIVILEGES are declarative; re-running
-- makes no further change. Safe to apply to a database that already has these
-- privileges, including production.

-- 1. Schema access. Without USAGE, table grants are unreachable.
grant usage on schema public to service_role;

-- 2. Existing tables and sequences.
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

-- 3. Future objects. Without this, the very next migration that creates a
-- table reintroduces the defect for that table. Scoped to objects created by
-- `postgres`, which is the role migrations run as and the owner whose default
-- ACL was found lacking DML.
alter default privileges for role postgres in schema public
  grant select, insert, update, delete on tables to service_role;

alter default privileges for role postgres in schema public
  grant usage, select on sequences to service_role;

-- ROLLBACK (not run here):
--   alter default privileges for role postgres in schema public
--     revoke select, insert, update, delete on tables from service_role;
--   alter default privileges for role postgres in schema public
--     revoke usage, select on sequences from service_role;
--   revoke select, insert, update, delete on all tables in schema public from service_role;
--   revoke usage, select on all sequences in schema public from service_role;
--
-- Rolling back restores the defect: a fresh database becomes unusable by the
-- server while production, which has the platform grants, continues to work.
