-- Final browser-authority root-cause repair: future objects must not inherit
-- platform-wide browser privileges merely because of who created them.
--
-- The production audit found two competing pg_default_acl owners in `public`:
--   * supabase_admin: tables -> anon/authenticated full table authority,
--                     functions -> browser EXECUTE,
--                     sequences -> browser read/write/usage;
--   * postgres:      tables/sequences carry a different platform default.
--
-- Migration history already grants browser access explicitly where product code
-- needs it. Therefore future browser authority must be opt-in, not inherited.
-- This migration changes DEFAULTS ONLY; it does not revoke any existing table
-- SELECT or existing per-object grants. Existing-object cleanup is a separate
-- step so read paths cannot be broken by a blanket revoke.
--
-- service_role is deliberately untouched. The canonical service-role repair in
-- 20260903120000 owns its server authority.

-- ---------------------------------------------------------------------------
-- WHICH OWNER ACTUALLY MATTERS, and why only one of them can be changed here.
--
-- A default ACL is selected by the role that CREATES the object. Every table in
-- `public` -- all 191, locally and in production -- is owned by `postgres`,
-- because that is the role migrations run as. So the `postgres` default ACL is
-- the one that governs every future migration-created object, and normalizing
-- it is what actually prevents the next SEC-001.
--
-- `supabase_admin` is a SUPERUSER, and the migration role is not a member of it
-- (verified in production: current_user = postgres, pg_has_role(...) = false,
-- rolsuper = false). `ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin` there
-- therefore raises
--
--     ERROR: permission denied to change default privileges
--
-- which aborts the migration. Running it unconditionally would fail the deploy.
-- It is attempted inside an exception handler instead: normalized where the
-- platform allows it, recorded as a NOTICE where it does not. That default only
-- governs objects the PLATFORM creates in `public`, which migrations do not
-- produce, so being unable to change it does not leave this tranche incomplete.
-- ---------------------------------------------------------------------------

-- Migration/local owner -- the one that governs every table this repository
-- creates. Normalizing it makes a fresh local database, a fresh hosted project,
-- and the long-lived production project converge on the same rule: browser
-- grants are earned by an explicit reviewed migration.
alter default privileges for role postgres in schema public
  revoke all privileges on tables from public, anon, authenticated;

alter default privileges for role postgres in schema public
  revoke all privileges on sequences from public, anon, authenticated;

-- FUNCTIONS: this revoke is kept, and it is NOT sufficient on its own.
--
-- Measured on PostgreSQL 17.6: a newly created function is born with proacl
-- NULL, and PostgreSQL then applies its BUILT-IN default of EXECUTE TO PUBLIC.
-- That built-in grant sits underneath pg_default_acl and cannot be suppressed
-- by any ALTER DEFAULT PRIVILEGES form -- proven by driving the default ACL to
-- `postgres=X service_role=X` (PUBLIC absent) and watching the next CREATE
-- FUNCTION still come out `=X/postgres  postgres=X  service_role=X`.
--
-- So this statement only removes anon/authenticated from the default ACL; it
-- does NOT stop a new function being publicly executable. That is precisely the
-- SEC-001 mechanism, and it stays open at the default layer by design of the
-- database. The durable control is therefore a CONTRACT, not a default:
-- lib/security/schema-authority-contract.local.test.ts fails the build if any
-- VOLATILE non-trigger function in `public` is reachable by anon or PUBLIC, so
-- a new mutating RPC must carry its own explicit REVOKE (see
-- 20260905120000, the SEC-001 fix, for the shape to copy).
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;

-- Hosted-platform owner, best-effort.
do $$
begin
  execute 'alter default privileges for role supabase_admin in schema public '
       || 'revoke all privileges on tables from public, anon, authenticated';
  execute 'alter default privileges for role supabase_admin in schema public '
       || 'revoke all privileges on sequences from public, anon, authenticated';
  execute 'alter default privileges for role supabase_admin in schema public '
       || 'revoke execute on functions from public, anon, authenticated';
  raise notice 'default privileges: supabase_admin normalized';
exception
  when insufficient_privilege then
    raise notice
      'default privileges: supabase_admin NOT normalized (migration role lacks superuser/membership). '
      'postgres-owned defaults are normalized, and every migration-created object is postgres-owned, '
      'so future migrations are covered. Platform-created objects in public remain on the platform default.';
end $$;

-- TYPES are intentionally not changed here. The audit found no owner-specific
-- pg_default_acl entry for types, and type USAGE is not the browser data-write
-- authority defect being remediated in this tranche.
