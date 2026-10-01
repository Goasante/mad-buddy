-- Make Life/domain-event idempotency inferable by PostgREST upsert.
--
-- The previous partial unique index was sufficient for raw SQL with a matching
-- conflict predicate, but Supabase/PostgREST sends ON CONFLICT(dedupe_key).
-- A normal UNIQUE index on a nullable column preserves multiple NULL values and
-- lets retries become no-ops without generating 23505 errors.

drop index if exists public.domain_events_dedupe_idx;
create unique index domain_events_dedupe_idx
  on public.domain_events(dedupe_key);
