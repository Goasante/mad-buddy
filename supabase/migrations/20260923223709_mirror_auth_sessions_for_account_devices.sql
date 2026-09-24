-- A user-facing, owner-readable projection of Supabase Auth sessions.
-- auth.sessions already contains the authoritative device sessions, but it is
-- deliberately outside the Data API. This projection exposes only the fields
-- needed by Settings > Sessions and omits IP addresses and refresh secrets.

create table if not exists public.account_sessions (
  session_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null,
  last_seen_at timestamptz not null,
  user_agent text,
  not_after timestamptz
);

create index if not exists account_sessions_user_seen_idx
  on public.account_sessions(user_id, last_seen_at desc);

alter table public.account_sessions enable row level security;

revoke all on public.account_sessions from anon;
grant select on public.account_sessions to authenticated;

drop policy if exists "account sessions owner read" on public.account_sessions;
create policy "account sessions owner read"
  on public.account_sessions for select
  to authenticated
  using ((select auth.uid()) = user_id);

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.sync_auth_session_projection()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    delete from public.account_sessions where session_id = old.id;
    return old;
  end if;

  insert into public.account_sessions (
    session_id,
    user_id,
    created_at,
    last_seen_at,
    user_agent,
    not_after
  ) values (
    new.id,
    new.user_id,
    coalesce(new.created_at, now()),
    coalesce(new.refreshed_at at time zone 'UTC', new.updated_at, new.created_at, now()),
    nullif(new.user_agent, ''),
    new.not_after
  )
  on conflict (session_id) do update set
    last_seen_at = excluded.last_seen_at,
    user_agent = excluded.user_agent,
    not_after = excluded.not_after;

  return new;
end;
$$;

revoke all on function private.sync_auth_session_projection() from public, anon, authenticated;

drop trigger if exists sync_account_session_projection on auth.sessions;
create trigger sync_account_session_projection
  after insert or update or delete on auth.sessions
  for each row execute function private.sync_auth_session_projection();

insert into public.account_sessions (
  session_id,
  user_id,
  created_at,
  last_seen_at,
  user_agent,
  not_after
)
select
  id,
  user_id,
  coalesce(created_at, now()),
  coalesce(refreshed_at at time zone 'UTC', updated_at, created_at, now()),
  nullif(user_agent, ''),
  not_after
from auth.sessions
on conflict (session_id) do update set
  last_seen_at = excluded.last_seen_at,
  user_agent = excluded.user_agent,
  not_after = excluded.not_after;

comment on table public.account_sessions is
  'Privacy-minimised owner-only projection of Supabase Auth sessions for Settings > Sessions. No IP addresses or token material.';
