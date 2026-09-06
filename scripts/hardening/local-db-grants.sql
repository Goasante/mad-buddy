-- LOCAL DEVELOPMENT STACK ONLY. Never run against production.
--
-- This helper predates the repository's explicit browser/server ACL contracts.
-- It used to blanket-grant all tables to `authenticated` and SELECT to `anon`
-- so local Docker behaved like the long-lived production project. That is now
-- known to hide the exact hosted-vs-local authority defects the security suite
-- is supposed to catch.
--
-- Browser authority is now migration-owned:
--   * required reads/writes are explicit per table/column;
--   * future browser defaults are deny-by-default;
--   * RLS narrows those explicit base privileges.
--
-- Therefore this local compatibility helper may repair ONLY trusted
-- `service_role` authority. It must never widen anon/authenticated beyond the
-- migration chain. Keeping schema USAGE is harmless and required for whatever
-- explicit per-object grants migrations give those roles.

grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

alter default privileges for role postgres in schema public
  grant select, insert, update, delete on tables to service_role;

alter default privileges for role postgres in schema public
  grant usage, select on sequences to service_role;

-- INTENTIONALLY ABSENT:
--   grant ... on all tables ... to anon/authenticated
--   alter default privileges ... grant ... to anon/authenticated
--
-- A local security test that needs to model historical production-wide browser
-- grants must add them inside a transaction and roll them back, as the SEC-002
-- exploit regression does.
