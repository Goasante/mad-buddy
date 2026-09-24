-- Phase 1 of the UpFor authority cutover: add a service-only atomic creator
-- before switching the web action. The old authenticated RPC remains usable
-- until every running app instance has picked up the new code.
create or replace function public.create_upfor_session_server(
  p_owner_id uuid,
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
  p_duration interval default null
)
returns public.hangout_sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_live integer;
  v_starts timestamptz;
  v_ends timestamptz;
  v_row public.hangout_sessions;
begin
  if p_owner_id is null then
    raise exception 'owner_required' using errcode = '42501';
  end if;

  v_starts := coalesce(p_starts_at, now());
  v_ends := case
    when p_starts_at is null and p_duration is not null then now() + p_duration
    else p_ends_at
  end;
  if v_ends is null or v_ends <= v_starts or v_ends - v_starts > interval '12 hours' then
    raise exception 'invalid_upfor_window' using errcode = 'P0001';
  end if;

  -- The product ceiling is fixed in the database; the caller cannot raise it.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_owner_id::text, 0));
  select count(*) into v_live
  from public.hangout_sessions
  where owner_id = p_owner_id
    and status in ('active', 'paused', 'full')
    and ends_at > now();
  if v_live >= 3 then
    raise exception 'upfor_limit_reached' using errcode = 'P0001';
  end if;

  insert into public.hangout_sessions (
    owner_id, activity_type, message, audience_type, broad_area_text,
    discovery_scope, starts_at, ends_at, timezone, max_participants,
    allow_pings, allow_friend_invites, area_tier, area_derived_at, status
  ) values (
    p_owner_id, p_activity_type, nullif(btrim(p_message), ''), p_audience_type,
    nullif(btrim(p_broad_area_text), ''), p_discovery_scope, v_starts,
    v_ends, p_timezone, p_max_participants, p_allow_pings,
    p_allow_friend_invites, p_area_tier, p_area_derived_at, 'active'
  ) returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.create_upfor_session_server(
  uuid, text, text, text, text, text, timestamptz, timestamptz,
  text, integer, boolean, boolean, text, timestamptz, interval
) from public, anon, authenticated;
grant execute on function public.create_upfor_session_server(
  uuid, text, text, text, text, text, timestamptz, timestamptz,
  text, integer, boolean, boolean, text, timestamptz, interval
) to service_role;

do $$
begin
  if has_function_privilege('anon',
      'public.create_upfor_session_server(uuid,text,text,text,text,text,timestamptz,timestamptz,text,integer,boolean,boolean,text,timestamptz,interval)'::regprocedure, 'EXECUTE')
     or has_function_privilege('authenticated',
      'public.create_upfor_session_server(uuid,text,text,text,text,text,timestamptz,timestamptz,text,integer,boolean,boolean,text,timestamptz,interval)'::regprocedure, 'EXECUTE') then
    raise exception 'UpFor server RPC is browser-accessible';
  end if;
end $$;
