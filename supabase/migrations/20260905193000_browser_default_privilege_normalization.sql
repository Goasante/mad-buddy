-- Final browser-authority root-cause repair: future migration-created objects
-- must not inherit browser authority merely because PostgreSQL supplies or the
-- platform configures broad defaults.
--
-- The production audit found competing pg_default_acl owners. Repository
-- migrations create public objects as `postgres`, so `postgres` is the owner
-- whose defaults must be authoritative for future repo-created objects.
--
-- Existing-object cleanup is handled separately. This migration changes
-- defaults only and deliberately does not subtract service_role authority.

-- Future postgres-owned tables/sequences in public are deny-by-default for
-- browser roles. Service-role defaults are already established by
-- 20260903120000_service_role_grant_reproducibility.sql.
alter default privileges for role postgres in schema public
  revoke all privileges on tables from public, anon, authenticated;

alter default privileges for role postgres in schema public
  revoke all privileges on sequences from public, anon, authenticated;

-- FUNCTIONS ARE DIFFERENT.
--
-- PostgreSQL's built-in default grants EXECUTE on new functions to PUBLIC. A
-- schema-scoped REVOKE cannot remove a privilege supplied by the GLOBAL default
-- (PostgreSQL 17 ALTER DEFAULT PRIVILEGES documentation is explicit about this).
-- Therefore the PUBLIC revoke MUST be global for the creating role.
--
-- Keep future repo-created functions server-only by default. A function that is
-- intentionally callable by authenticated/anon must earn an explicit GRANT in
-- the same reviewed migration that creates it.
alter default privileges for role postgres
  revoke execute on functions from public, anon, authenticated;

alter default privileges for role postgres
  grant execute on functions to service_role;

-- If any postgres per-schema function grants already exist, remove browser
-- additions there too. This cannot replace the global PUBLIC revoke above; it
-- only removes schema-local additions.
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated;

-- Hosted-platform owner, best-effort for TABLES/SEQUENCES only. The migration
-- role is not a member of supabase_admin in Production, so these statements are
-- expected to be skipped there. We intentionally do NOT change the global
-- supabase_admin FUNCTION default: doing so would affect platform-created
-- functions across schemas that this repository does not own.
do $$
begin
  execute 'alter default privileges for role supabase_admin in schema public '
       || 'revoke all privileges on tables from public, anon, authenticated';
  execute 'alter default privileges for role supabase_admin in schema public '
       || 'revoke all privileges on sequences from public, anon, authenticated';
  raise notice 'default privileges: supabase_admin table/sequence defaults normalized';
exception
  when insufficient_privilege then
    raise notice
      'default privileges: supabase_admin defaults not alterable by migration role; '
      'repo-created postgres-owned defaults are normalized.';
end $$;

-- TYPES are intentionally unchanged: the audit found no owner-specific type
-- default ACL and type USAGE is outside this browser write-authority defect.
