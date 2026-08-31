-- "Now" means the database's now, not a clock the app read a moment earlier.
--
-- OBSERVED IN PRODUCTION:
--
--   starts_at  = 15:57:22.740
--   created_at = 15:57:22.897
--
-- The start preceded the row's own creation by about the RPC round trip. The
-- action captured Date.now() before validation, area derivation and the network
-- hop, then sent that instant as the start. Harmless for discovery today --
-- `starts_at <= now()` was already true -- but it is wrong, and under clock
-- skew between the app server and the database it could store a start
-- meaningfully in the past, or briefly in the future, which is exactly the
-- thing the scheduled/live distinction is derived from.
--
-- FIX: `p_starts_at` becomes nullable and NULL means "now, decided here".
-- A "Later today" start is still passed explicitly and stored exactly as
-- chosen -- the whole point of scheduling is that the person picked the time.
--
-- The end is derived the same way so a duration stays a duration: the caller
-- sends the LENGTH for an immediate UpFor, and the function adds it to its own
-- start. `ends_at > starts_at` is therefore preserved by construction, and the
-- existing hangout_ends_after_start constraint still guards it.
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
  p_limit integer,
  -- Length of an immediate UpFor, used only when p_starts_at is NULL. Sent as
  -- an interval rather than an end instant precisely so it cannot carry a
  -- stale clock reading with it.
  p_duration interval default null
)
returns public.hangout_sessions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner uuid := auth.uid();
  v_live integer;
  v_starts timestamptz;
  v_ends timestamptz;
  v_row public.hangout_sessions;
begin
  if v_owner is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  -- NULL start means now, and "now" is decided here rather than by whatever
  -- the caller's clock said before the request travelled.
  v_starts := coalesce(p_starts_at, now());
  v_ends := case
    when p_starts_at is null and p_duration is not null then now() + p_duration
    else p_ends_at
  end;

  if v_ends is null or v_ends <= v_starts then
    raise exception 'invalid_upfor_window' using errcode = 'P0001';
  end if;

  -- Serialise this owner's concurrent creations. Held to end of transaction.
  perform pg_advisory_xact_lock(hashtextextended(v_owner::text, 0));

  -- Scheduled and live alike are commitments the owner currently holds, so both
  -- spend a slot. Terminal rows are excluded by the status filter, which is why
  -- cancelling or converting frees a slot with no sweep in between.
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
    nullif(btrim(p_broad_area_text), ''), p_discovery_scope, v_starts,
    v_ends, p_timezone, p_max_participants, p_allow_pings,
    p_allow_friend_invites, p_area_tier, p_area_derived_at, 'active'
  )
  returning * into v_row;

  return v_row;
end;
$$;

-- The signature gained a defaulted parameter, so this is a new overload rather
-- than a replacement. Grant it the same way the original was granted, and
-- revoke the default-privilege grants by role name -- production carries ALTER
-- DEFAULT PRIVILEGES that hands EXECUTE to anon on every new function.
revoke all on function public.create_upfor_session(
  text, text, text, text, text, timestamptz, timestamptz, text, integer,
  boolean, boolean, text, timestamptz, integer, interval
) from public;

revoke execute on function public.create_upfor_session(
  text, text, text, text, text, timestamptz, timestamptz, text, integer,
  boolean, boolean, text, timestamptz, integer, interval
) from anon;

grant execute on function public.create_upfor_session(
  text, text, text, text, text, timestamptz, timestamptz, text, integer,
  boolean, boolean, text, timestamptz, integer, interval
) to authenticated, service_role;
