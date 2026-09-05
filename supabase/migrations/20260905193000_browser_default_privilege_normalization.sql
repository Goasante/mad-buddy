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

-- Hosted-production owner.
alter default privileges for role supabase_admin in schema public
  revoke all privileges on tables from public, anon, authenticated;

alter default privileges for role supabase_admin in schema public
  revoke all privileges on sequences from public, anon, authenticated;

alter default privileges for role supabase_admin in schema public
  revoke execute on functions from public, anon, authenticated;

-- Migration/local owner. Normalizing both owners makes a fresh local database,
-- a fresh hosted project, and the long-lived production project converge on the
-- same rule: browser grants are earned by an explicit reviewed migration.
alter default privileges for role postgres in schema public
  revoke all privileges on tables from public, anon, authenticated;

alter default privileges for role postgres in schema public
  revoke all privileges on sequences from public, anon, authenticated;

alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;

-- TYPES are intentionally not changed here. The audit found no owner-specific
-- pg_default_acl entry for types, and type USAGE is not the browser data-write
-- authority defect being remediated in this tranche.
