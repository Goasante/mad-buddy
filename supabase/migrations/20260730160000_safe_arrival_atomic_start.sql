-- Safe Arrival: atomic journey start.
--
-- WHY THIS EXISTS
-- Starting a journey previously ran as three separate statements from the
-- application: insert the session, insert the watcher rows, then notify. A
-- failure between the first and second left a journey with NO watchers — a
-- safety session that looks armed and can never alert anybody. The active-count
-- cap was also read-then-written, so two taps that raced both passed the check.
--
-- This function does the count check, the session insert and the watcher
-- inserts in ONE transaction, so a journey and its watchers are created
-- together or not at all.
--
-- It is additive: no table, column, policy or index is altered, and the
-- existing insert path keeps working if anything still uses it.
--
-- IDEMPOTENCY (double-tap / retry): if the same traveller already has a live
-- journey with the same destination and expected arrival created in the last
-- two minutes, that journey's id is returned instead of creating a second one.
-- Retrying a request whose response was lost is therefore safe.
--
-- Rollback:
--   drop function if exists public.start_safe_arrival(
--     uuid, text, timestamptz, integer, text, uuid[], integer);

create or replace function public.start_safe_arrival(
  p_traveller_id uuid,
  p_destination_label text,
  p_expected_arrival_at timestamptz,
  p_grace_period_minutes integer,
  p_note text,
  p_contact_ids uuid[],
  p_max_active integer
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_id uuid;
  v_active_count integer;
  v_eligible uuid[];
begin
  if p_traveller_id is null then
    raise exception 'traveller required' using errcode = '22023';
  end if;

  -- Same live set the application treats as "active" (a journey still awaiting
  -- its outcome), so the cap here and the cap in the UI agree.
  select count(*) into v_active_count
  from public.safe_arrival_sessions s
  where s.traveller_id = p_traveller_id
    and s.status in ('draft', 'pending_acknowledgement', 'active', 'grace_period', 'extended', 'unconfirmed');

  -- Idempotent replay. Checked BEFORE the cap so a duplicate submit returns the
  -- journey it already created rather than failing with "limit reached".
  select s.id into v_session_id
  from public.safe_arrival_sessions s
  where s.traveller_id = p_traveller_id
    and s.destination_label = p_destination_label
    and s.expected_arrival_at = p_expected_arrival_at
    and s.status in ('active', 'extended')
    and s.created_at > now() - interval '2 minutes'
  order by s.created_at desc
  limit 1;

  if v_session_id is not null then
    return v_session_id;
  end if;

  if p_max_active is not null and v_active_count >= p_max_active then
    raise exception 'safe_arrival_active_limit' using errcode = 'P0001';
  end if;

  -- Watchers must be approved, mutual, unblocked Muddies who have not silently
  -- opted out of this traveller's requests. The application filters this too;
  -- re-asserting it inside the transaction means a bug up there can never
  -- persist a watcher who was never entitled to see the journey.
  select coalesce(array_agg(distinct c.id), '{}'::uuid[]) into v_eligible
  from unnest(p_contact_ids) as c(id)
  where c.id <> p_traveller_id
    and exists (
      select 1 from public.friendships f
      where (f.user_one_id = p_traveller_id and f.user_two_id = c.id)
         or (f.user_one_id = c.id and f.user_two_id = p_traveller_id)
    )
    and not exists (
      select 1 from public.blocked_users b
      where (b.blocker_id = p_traveller_id and b.blocked_id = c.id)
         or (b.blocker_id = c.id and b.blocked_id = p_traveller_id)
    )
    and not exists (
      select 1 from public.safe_arrival_blocks sab
      where sab.user_id = c.id and sab.blocked_traveller_id = p_traveller_id
    );

  if array_length(v_eligible, 1) is null then
    raise exception 'safe_arrival_no_watchers' using errcode = 'P0001';
  end if;

  insert into public.safe_arrival_sessions (
    traveller_id, destination_type, destination_label,
    expected_arrival_at, grace_period_minutes, note, status
  )
  values (
    p_traveller_id, 'custom', p_destination_label,
    p_expected_arrival_at, p_grace_period_minutes, nullif(btrim(coalesce(p_note, '')), ''), 'active'
  )
  returning id into v_session_id;

  -- Watchers land in the same transaction as the journey. notified_at records
  -- that the invite was DISPATCHED; acknowledgement_status stays 'pending' until
  -- the watcher answers, which is what the traveller's screen distinguishes.
  insert into public.safe_arrival_contacts (session_id, contact_user_id, notified_at)
  select v_session_id, e.id, now()
  from unnest(v_eligible) as e(id)
  on conflict (session_id, contact_user_id) do nothing;

  insert into public.safe_arrival_events (session_id, event_type, created_by, metadata)
  values (
    v_session_id, 'created', p_traveller_id,
    jsonb_build_object('watcherCount', coalesce(array_length(v_eligible, 1), 0))
  );

  return v_session_id;
end;
$$;

-- Callable only by the service role: every write path goes through a server
-- action that has already authenticated the traveller. Revoking the default
-- PUBLIC grant stops an authenticated client calling it directly and passing
-- someone else's traveller id or its own p_max_active.
revoke all on function public.start_safe_arrival(
  uuid, text, timestamptz, integer, text, uuid[], integer) from public;
revoke all on function public.start_safe_arrival(
  uuid, text, timestamptz, integer, text, uuid[], integer) from anon;
revoke all on function public.start_safe_arrival(
  uuid, text, timestamptz, integer, text, uuid[], integer) from authenticated;
grant execute on function public.start_safe_arrival(
  uuid, text, timestamptz, integer, text, uuid[], integer) to service_role;

-- Index supporting the idempotency probe above (traveller + recency).
create index if not exists safe_arrival_sessions_recent_idx
  on public.safe_arrival_sessions(traveller_id, created_at desc);
