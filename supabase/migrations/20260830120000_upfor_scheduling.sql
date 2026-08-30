-- UpFor scheduling ("Later today") + an atomic concurrency ceiling.
--
-- WHAT THIS DELIBERATELY DOES NOT DO
--
-- It adds no `scheduled` status. Scheduled vs active is already fully
-- expressible from the timestamps this table has carried since it was created:
--
--   SCHEDULED  now < starts_at
--   ACTIVE     starts_at <= now < ends_at
--   TERMINAL   status in ('expired','cancelled','converted_to_plan')
--
-- Storing a `scheduled` status would create a second authority for a fact the
-- clock already answers, and the two would drift the moment a row was not swept
-- on time. `starts_at` already exists and already defaults to now(), so "Now"
-- keeps its exact current meaning and "Later today" is simply a future value.
--
-- It also does not change the access boundary. UpFor remains a paid surface;
-- the concurrency ceiling below is a flat anti-abuse limit for people who
-- already have Access, not a tier.

-- 1. Timezone: the calendar authority a same-day rule is judged against.
--
-- Same-day cannot mean DATE(ts AT TIME ZONE 'UTC') unless UTC really is the
-- user's calendar, which for Accra, London or New York it is not. The zone is
-- stored on the row rather than resolved at read time so the record keeps the
-- calendar its rule was actually evaluated against -- if the owner later
-- travels, the row does not retroactively change which day it belonged to.
--
-- Mirrors plans.timezone (text, NOT NULL, default 'UTC') so the two lifecycles
-- describe time the same way. The server validates it is a real IANA zone
-- before writing; the default keeps every existing row valid.
alter table public.hangout_sessions
  add column if not exists timezone text not null default 'UTC';

comment on column public.hangout_sessions.timezone is
  'IANA timezone (e.g. Africa/Accra) the same-day scheduling rule was evaluated against. Validated server-side; never trusted raw from a client.';

-- 2. A scheduled UpFor must not be discoverable before it starts.
--
-- The existing discovery policies gate on `status = 'active' AND ends_at > now()`
-- and say nothing about starts_at, because until now starts_at was always
-- now(). With "Later today" that would publish a session to Muddies (and to
-- nearby discovery) hours before its owner intended it to be visible.
--
-- Both policies are replaced with the same predicate plus `starts_at <= now()`.
-- Nothing else about them changes: the friendship test, the discovery_scope
-- opt-in and the self-exclusion are all preserved verbatim.
drop policy if exists "muddies read active hangouts" on public.hangout_sessions;
create policy "muddies read active hangouts"
  on public.hangout_sessions
  for select
  using (
    status = 'active'
    and starts_at <= now()
    and ends_at > now()
    and exists (
      select 1
      from public.friendships f
      where (
        (f.user_one_id = auth.uid() and f.user_two_id = hangout_sessions.owner_id)
        or (f.user_two_id = auth.uid() and f.user_one_id = hangout_sessions.owner_id)
      )
      and f.ended_at is null
    )
  );

drop policy if exists "opted-in upfors are discovery eligible" on public.hangout_sessions;
create policy "opted-in upfors are discovery eligible"
  on public.hangout_sessions
  for select
  using (
    discovery_scope = 'nearby'
    and status = 'active'
    and starts_at <= now()
    and ends_at > now()
    and auth.uid() is not null
    and owner_id <> auth.uid()
  );

-- The owner's own "for ALL" policy is untouched, so a creator can always see,
-- edit and cancel their own scheduled UpFor before it goes live.

-- 3. The concurrency ceiling, made atomic.
--
-- THE DEFECT THIS REPLACES. Creation used to read the count and then insert as
-- two independent statements:
--
--     if ((await activeHangoutCount(admin, userId)) >= MAX_ACTIVE_UPFORS) ...
--     await admin.from('hangout_sessions').insert(...)
--
-- Two concurrent requests from one account both read 2, both pass, and both
-- insert -- ending at 4. Counting in application code cannot fix that; the
-- check and the write have to be one statement against one snapshot.
--
-- This function does the count and the insert together. `pg_advisory_xact_lock`
-- on the owner serialises concurrent creations by the SAME account only (a
-- different owner hashes elsewhere and never waits), and the lock is released
-- with the transaction whether it commits or aborts.
--
-- SECURITY DEFINER with a pinned search_path, and the owner is taken from
-- auth.uid() rather than from a parameter -- a caller cannot create an UpFor
-- for somebody else, and cannot spend another account's allowance.
create or replace function public.create_upfor_session(
  p_activity_type text,
  p_message text,
  p_audience_type text,
  p_broad_area_text text,
  p_discovery_scope text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_timezone text,
  p_max_participants integer,
  p_allow_pings boolean,
  p_allow_friend_invites boolean,
  p_area_tier text,
  p_area_derived_at timestamptz,
  p_limit integer
)
returns public.hangout_sessions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner uuid := auth.uid();
  v_live integer;
  v_row public.hangout_sessions;
begin
  if v_owner is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  -- Serialise this owner's concurrent creations. Held to end of transaction.
  perform pg_advisory_xact_lock(hashtextextended(v_owner::text, 0));

  -- What consumes a slot: a session that is live-status AND has not elapsed.
  -- That is scheduled (starts later, not yet ended) and active alike, because
  -- both are commitments the owner currently holds. Terminal rows -- expired,
  -- cancelled, converted_to_plan -- are excluded by the status filter, so a
  -- slot is released the instant the lifecycle says the old one is finished,
  -- with no sweep or cron in between.
  select count(*) into v_live
  from public.hangout_sessions
  where owner_id = v_owner
    and status in ('active', 'paused', 'full')
    and ends_at > now();

  if v_live >= p_limit then
    raise exception 'upfor_limit_reached' using errcode = 'P0001';
  end if;

  insert into public.hangout_sessions (
    owner_id, activity_type, message, audience_type, broad_area_text,
    discovery_scope, starts_at, ends_at, timezone, max_participants,
    allow_pings, allow_friend_invites, area_tier, area_derived_at, status
  ) values (
    v_owner, p_activity_type, nullif(btrim(p_message), ''), p_audience_type,
    nullif(btrim(p_broad_area_text), ''), p_discovery_scope, p_starts_at,
    p_ends_at, p_timezone, p_max_participants, p_allow_pings,
    p_allow_friend_invites, p_area_tier, p_area_derived_at, 'active'
  )
  returning * into v_row;

  return v_row;
end;
$$;

-- Locking the function down also locks out the server, which runs as
-- service_role, so EXECUTE is granted back explicitly rather than left to the
-- PUBLIC default this revoke removes.
revoke all on function public.create_upfor_session(
  text, text, text, text, text, timestamptz, timestamptz, text, integer,
  boolean, boolean, text, timestamptz, integer
) from public;

grant execute on function public.create_upfor_session(
  text, text, text, text, text, timestamptz, timestamptz, text, integer,
  boolean, boolean, text, timestamptz, integer
) to authenticated, service_role;

-- Supports both the allowance count and the "Coming Up" read, which are the
-- two hot per-owner lookups this change introduces.
create index if not exists hangout_sessions_owner_window_idx
  on public.hangout_sessions (owner_id, status, ends_at, starts_at);
