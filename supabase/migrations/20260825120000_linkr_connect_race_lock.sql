-- Make reciprocal Linkr connects race-safe.
--
-- The original function relied on unique constraints after checking for the
-- reciprocal action. Two first-time reciprocal calls can both insert their own
-- action in separate transactions, then both miss the other's uncommitted row
-- and return unmatched. A transaction-scoped advisory lock on the canonical
-- pair makes those calls resolve in order without locking unrelated people.

create or replace function public.linkr_record_connect(
  p_actor uuid,
  p_target uuid,
  p_event_id uuid default null
)
returns table (matched boolean, connection_id uuid, created boolean)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_low uuid;
  v_high uuid;
  v_reciprocal boolean;
  v_connection_id uuid;
  v_created boolean := false;
begin
  if p_actor = p_target then
    raise exception 'linkr: cannot connect with self';
  end if;

  v_low  := least(p_actor, p_target);
  v_high := greatest(p_actor, p_target);

  -- Serialize only this pair. The waiting transaction resumes after the first
  -- commits, so its reciprocal read sees the other person's action.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_low::text || ':' || v_high::text, 0)
  );

  insert into public.linkr_actions (actor_id, target_id, action, event_id, expires_at)
  values (p_actor, p_target, 'connect', p_event_id, null)
  on conflict (actor_id, target_id)
  do update set action = 'connect',
                event_id = coalesce(excluded.event_id, public.linkr_actions.event_id),
                expires_at = null,
                updated_at = now();

  select exists (
    select 1 from public.linkr_actions
    where actor_id = p_target and target_id = p_actor and action = 'connect'
  ) into v_reciprocal;

  if not v_reciprocal then
    return query select false, null::uuid, false;
    return;
  end if;

  insert into public.linkr_connections (user_low, user_high, event_id)
  values (v_low, v_high, p_event_id)
  on conflict (user_low, user_high) do nothing
  returning id into v_connection_id;

  if v_connection_id is not null then
    v_created := true;
  else
    update public.linkr_connections
       set ended_at = null,
           connected_at = case when ended_at is not null then now() else connected_at end,
           updated_at = now()
     where user_low = v_low and user_high = v_high
     returning id into v_connection_id;
  end if;

  return query select true, v_connection_id, v_created;
end;
$fn$;

revoke all on function public.linkr_record_connect(uuid, uuid, uuid) from public;
revoke all on function public.linkr_record_connect(uuid, uuid, uuid) from anon;
revoke all on function public.linkr_record_connect(uuid, uuid, uuid) from authenticated;
grant execute on function public.linkr_record_connect(uuid, uuid, uuid) to service_role;
