-- Runtime error hardening found during the final production-log sweep.
--
-- 1) private.expire_chat_messages referenced messages.updated_at, which does not
--    exist in the canonical messages table.
-- 2) jobs.idempotency_key used a partial unique index. PostgreSQL itself can
--    target that index with a matching predicate, but PostgREST/Supabase upsert
--    sends ON CONFLICT(idempotency_key) without the predicate, so reminder
--    enqueue attempts failed with SQLSTATE 42P10.
--
-- A normal UNIQUE index on a nullable column still permits multiple NULLs, so
-- the partial predicate is unnecessary and removing it preserves semantics
-- while making the PostgREST conflict target inferable.

create or replace function private.expire_chat_messages()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  retired_count integer := 0;
begin
  with retired as (
    update public.messages
    set
      status = 'deleted',
      deleted_at = coalesce(deleted_at, now()),
      text_content = null
    where expires_at is not null
      and expires_at <= now()
      and kept_at is null
      and deleted_at is null
    returning id, media_id
  ), queued as (
    insert into public.media_deletion_queue (media_asset_id, reason)
    select media_id, 'parent_expired'
    from retired
    where media_id is not null
    on conflict (media_asset_id) do nothing
    returning media_asset_id
  )
  select count(*)::integer into retired_count from retired;

  return retired_count;
end;
$$;

revoke all on function private.expire_chat_messages() from public, anon, authenticated;
grant execute on function private.expire_chat_messages() to service_role;
grant usage on schema private to service_role;

drop index if exists public.jobs_idempotency_unique;
create unique index jobs_idempotency_unique
  on public.jobs(idempotency_key);
