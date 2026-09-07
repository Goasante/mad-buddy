-- UPFOR PARTICIPANTS ARE LEGITIMATE PLAN PARTICIPANTS, WITHOUT BEING MUDDIES.
--
-- THE DEFECT. UpFor is not only for existing Muddies: a creator may opt a
-- session into discovery beyond their own circle (`discovery_scope = 'nearby'`,
-- gated by canStrangerDiscoverUpFor), and a non-Muddy can legitimately
-- discover it, request to join, and be ACCEPTED by the owner. The canonical
-- Plan lifecycle then refused them. Converting such an UpFor raised
-- PLAN_PARTICIPANT_INELIGIBLE outright; when a conversion did succeed the
-- reconciler excluded the same person from the Plan Chat, and
-- set_plan_participant_rsvp would have trapped them afterwards. The product
-- offered a loop it could not complete.
--
-- THE RULE THIS ENCODES, and its exact limits:
--
--     accepted participant of THIS UpFor
--         -> legitimate participant of THIS converted Plan
--         -> legitimate member of THIS Plan Chat
--
-- Nothing more. It is CONTEXTUAL permission, not friendship. It creates no
-- friendship, no Muddy relationship, no Linkr mutual, no direct-message
-- authority, and no proximity exposure. It does not make the person eligible
-- for any other Plan, any other UpFor, or any other conversation. A Plan Chat
-- with two people in it is still a Plan Chat.
--
-- WHY THE DATABASE IS THE RIGHT PLACE. The permission is derived from stored
-- facts the client cannot forge:
--
--     plans.source_hangout_id
--       + hangout_requests.hangout_session_id
--       + hangout_requests.requester_id
--       + hangout_requests.status = 'accepted'
--
-- The owner explicitly accepted that person. That acceptance is the permission
-- -- not "nearby", and not any discovery surface. A different surface that
-- legitimately produces an accepted request works identically, and no
-- client-supplied id can manufacture one.
--
-- WHAT DELIBERATELY DOES NOT CHANGE. `add_plan_participants` still requires an
-- active friendship. That path takes ids straight from the client and is how
-- somebody manually invites people to an ordinary Plan; relaxing it would turn
-- the participant picker into a stranger picker, which is precisely what this
-- change must not do.
--
-- A LIVE BLOCK STILL WINS EVERYWHERE. Every predicate below checks blocks
-- first and independently, so an old acceptance can never be used to reach
-- somebody who has since blocked you -- in either direction.

-- ---------------------------------------------------------------------------
-- One predicate, so the rule cannot drift between call sites.
-- ---------------------------------------------------------------------------

/**
 * Is this person a legitimate participant of THIS plan, relative to its host?
 *
 * Two independent grounds, and a block that overrides both:
 *
 *   1. an active friendship  -- ordinary Plan membership, unchanged
 *   2. an accepted request on the plan's own source UpFor -- contextual
 *
 * `security definer` because callers are `security invoker` functions running
 * as the acting user, who cannot necessarily read the other side's friendship
 * or the session's request rows. `stable` and search_path-pinned, matching the
 * convention `is_friend` established.
 */
create or replace function public.is_plan_participant_eligible(
  p_plan_id uuid,
  p_host_id uuid,
  p_candidate_id uuid
)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select
    -- A live block in EITHER direction disqualifies, before anything else is
    -- considered. Checked first so no ground below can bypass it.
    not exists (
      select 1
      from public.blocked_users as b
      where (b.blocker_id = p_host_id and b.blocked_id = p_candidate_id)
         or (b.blocker_id = p_candidate_id and b.blocked_id = p_host_id)
    )
    and (
      -- GROUND 1: ordinary Plan membership. Unchanged behaviour.
      exists (
        select 1
        from public.friendships as f
        where f.ended_at is null
          and (
            (f.user_one_id = p_host_id and f.user_two_id = p_candidate_id)
            or (f.user_two_id = p_host_id and f.user_one_id = p_candidate_id)
          )
      )
      -- GROUND 2: contextual membership, scoped to THIS plan's source UpFor.
      -- The join through plans.source_hangout_id is what keeps it scoped: an
      -- acceptance on some other session grants nothing here.
      or exists (
        select 1
        from public.plans as p
        join public.hangout_requests as hr
          on hr.hangout_session_id = p.source_hangout_id
        where p.id = p_plan_id
          and p.source_hangout_id is not null
          and hr.requester_id = p_candidate_id
          and hr.status = 'accepted'
      )
    );
$$;

revoke all on function public.is_plan_participant_eligible(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.is_plan_participant_eligible(uuid, uuid, uuid) to service_role;

comment on function public.is_plan_participant_eligible(uuid, uuid, uuid) is
  'Whether a candidate may participate in a plan: an active friendship OR an accepted request on that plan''s own source UpFor, and no live block either way. Contextual only -- creates and implies no relationship.';

-- ---------------------------------------------------------------------------
-- reconcile_plan_conversation_members: admit contextual participants to the
-- Plan Chat, and stop evicting them.
-- ---------------------------------------------------------------------------

create or replace function public.reconcile_plan_conversation_members(p_plan_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_creator_id uuid;
  v_conversation_id uuid;
  v_existing_type text;
  v_created boolean := false;
begin
  select p.creator_id
    into v_creator_id
  from public.plans as p
  where p.id = p_plan_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'PLAN_NOT_FOUND';
  end if;

  select c.id, c.conversation_type
    into v_conversation_id, v_existing_type
  from public.conversations as c
  where c.context_type = 'plan'
    and c.context_id = p_plan_id
  limit 1;

  if v_conversation_id is not null and v_existing_type <> 'plan' then
    raise exception using errcode = 'P0001', message = 'PLAN_CONVERSATION_CONTEXT_CONFLICT';
  end if;

  if v_conversation_id is null then
    insert into public.conversations (
      conversation_type,
      created_by,
      context_type,
      context_id,
      status
    ) values (
      'plan',
      v_creator_id,
      'plan',
      p_plan_id,
      'active'
    )
    returning id into v_conversation_id;

    v_created := true;
  end if;

  -- Host membership is unconditional and canonical.
  insert into public.conversation_members (
    conversation_id,
    user_id,
    role,
    status,
    history_visible_from
  ) values (
    v_conversation_id,
    v_creator_id,
    'owner',
    'joined',
    to_timestamp(0)
  )
  on conflict (conversation_id, user_id) do update
    set role = 'owner',
        status = 'joined',
        left_at = null,
        updated_at = now();

  -- Going/Maybe participants join only while they remain active, approved,
  -- unblocked Muddies of the host. Invited/viewed/waitlisted users do not gain
  -- access merely because a participant row exists.
  insert into public.conversation_members (
    conversation_id,
    user_id,
    role,
    status,
    history_visible_from
  )
  select
    v_conversation_id,
    pp.user_id,
    'member',
    'joined',
    to_timestamp(0)
  from public.plan_participants as pp
  where pp.plan_id = p_plan_id
    and pp.user_id <> v_creator_id
    and pp.rsvp_status in ('going', 'maybe')
    -- Friendship OR an accepted request on this plan's own source UpFor, and
    -- no live block either way. The predicate owns the whole rule so the admit
    -- and evict clauses can never disagree about who belongs here.
    and public.is_plan_participant_eligible(p_plan_id, v_creator_id, pp.user_id)
  on conflict (conversation_id, user_id) do update
    set role = 'member',
        status = 'joined',
        left_at = null,
        updated_at = now();

  update public.conversation_members as cm
  set status = 'left',
      left_at = coalesce(cm.left_at, now()),
      updated_at = now()
  where cm.conversation_id = v_conversation_id
    and cm.status = 'joined'
    and cm.user_id <> v_creator_id
    and not exists (
      select 1
      from public.plan_participants as pp
      where pp.plan_id = p_plan_id
        and pp.user_id = cm.user_id
        and pp.rsvp_status in ('going', 'maybe')
        and public.is_plan_participant_eligible(p_plan_id, v_creator_id, pp.user_id)
    );

  -- Preserve the established one-time Plan conversation system event. System
  -- events are excluded from human unread counts by the canonical projection.
  if v_created then
    insert into public.messages (
      conversation_id,
      sender_id,
      message_type,
      system_event_type,
      text_content,
      client_message_id,
      status
    ) values (
      v_conversation_id,
      null,
      'system',
      'conversation_created',
      'Conversation started.',
      'plan:' || p_plan_id::text || ':conversation-created',
      'sent'
    )
    on conflict (conversation_id, client_message_id)
      where message_type = 'system' and client_message_id is not null
      do nothing;

    update public.conversations
    set last_message_at = now(),
        updated_at = now()
    where id = v_conversation_id;
  end if;

  return v_conversation_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- set_plan_participant_rsvp: a contextual participant must not be trapped.
-- ---------------------------------------------------------------------------
--
-- Only the eligibility clause changes. Every other rule -- removed
-- participants, closed plans, RSVP deadlines, the going-count limit -- is
-- untouched, because none of them is about friendship.

create or replace function public.set_plan_participant_rsvp(
  p_actor_id uuid,
  p_plan_id uuid,
  p_status text
)
returns table (
  rsvp_status text,
  conversation_id uuid
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_plan record;
  v_participant record;
  v_final_status text;
  v_going_count integer;
  v_conversation_id uuid;
begin
  if p_status not in ('going', 'maybe', 'not_going') then
    raise exception using errcode = 'P0001', message = 'PLAN_RSVP_INVALID';
  end if;

  select p.creator_id, p.status, p.rsvp_deadline, p.max_participants
    into v_plan
  from public.plans as p
  where p.id = p_plan_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'PLAN_NOT_FOUND';
  end if;

  select pp.rsvp_status
    into v_participant
  from public.plan_participants as pp
  where pp.plan_id = p_plan_id
    and pp.user_id = p_actor_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'PLAN_PARTICIPANT_NOT_FOUND';
  end if;
  if v_participant.rsvp_status = 'removed' then
    raise exception using errcode = 'P0001', message = 'PLAN_PARTICIPANT_REMOVED';
  end if;
  if v_plan.status in ('cancelled', 'completed', 'expired') then
    raise exception using errcode = 'P0001', message = 'PLAN_CLOSED';
  end if;
  if p_status in ('going', 'maybe')
     and v_plan.rsvp_deadline is not null
     and now() > v_plan.rsvp_deadline then
    raise exception using errcode = 'P0001', message = 'PLAN_RSVP_DEADLINE_PASSED';
  end if;

  if p_status in ('going', 'maybe') and p_actor_id <> v_plan.creator_id then
    -- The one changed clause: a contextual participant must not be trapped.
    -- An accepted requester on this plan's own source UpFor can answer their
    -- own RSVP like anybody else. Blocks, removals, closed plans and the
    -- deadline are all still enforced above and below, untouched.
    if not public.is_plan_participant_eligible(p_plan_id, v_plan.creator_id, p_actor_id) then
      raise exception using errcode = 'P0001', message = 'PLAN_PARTICIPANT_INELIGIBLE';
    end if;
  end if;

  v_final_status := p_status;
  if p_status = 'going' and v_participant.rsvp_status <> 'going' then
    select count(*)::integer
      into v_going_count
    from public.plan_participants as pp
    where pp.plan_id = p_plan_id
      and pp.rsvp_status = 'going'
      and pp.user_id <> p_actor_id;
    if v_going_count >= v_plan.max_participants then
      v_final_status := 'waitlisted';
    end if;
  end if;

  update public.plan_participants
  set rsvp_status = v_final_status,
      responded_at = now(),
      updated_at = now()
  where plan_id = p_plan_id
    and user_id = p_actor_id;

  v_conversation_id := public.reconcile_plan_conversation_members(p_plan_id);
  return query select v_final_status, v_conversation_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- create_plan_lifecycle: accept contextual participants at conversion time.
-- ---------------------------------------------------------------------------
--
-- Replayed verbatim from 20260814200000 with ONE block changed -- the candidate
-- eligibility check. Everything else (idempotency, limits, participant seeding,
-- conversation creation, the UpFor status transition, notification fan-out) is
-- byte-identical, so this migration cannot quietly alter behaviour it does not
-- name.

create or replace function public.create_plan_lifecycle(
  p_actor_id uuid,
  p_request_key text,
  p_title text,
  p_description text,
  p_plan_type text,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_timezone text,
  p_rsvp_deadline timestamptz,
  p_place_type text,
  p_custom_place_text text,
  p_reminder_minutes integer,
  p_category text,
  p_invitee_ids uuid[],
  p_initial_going_ids uuid[],
  p_source_hangout_id uuid,
  p_effective_max_active_plans integer,
  p_effective_max_participants integer
)
returns table (
  plan_id uuid,
  conversation_id uuid,
  created boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_plan_id uuid;
  v_conversation_id uuid;
  v_idempotency_id uuid;
  v_existing record;
  v_hangout record;
  v_candidate_ids uuid[] := array[]::uuid[];
  v_initial_going_ids uuid[] := array[]::uuid[];
  v_ineligible_ids uuid[] := array[]::uuid[];
  v_active_count integer;
  v_candidate_count integer;
  v_status text;
  v_job_kind text;
  v_recipient_id uuid;
begin
  if p_actor_id is null then
    raise exception using errcode = 'P0001', message = 'PLAN_ACTOR_REQUIRED';
  end if;
  if p_request_key is null
     or p_request_key !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception using errcode = 'P0001', message = 'PLAN_REQUEST_KEY_INVALID';
  end if;
  if char_length(btrim(coalesce(p_title, ''))) not between 1 and 80 then
    raise exception using errcode = 'P0001', message = 'PLAN_TITLE_INVALID';
  end if;
  if p_plan_type not in ('quick', 'scheduled', 'poll') then
    raise exception using errcode = 'P0001', message = 'PLAN_TYPE_INVALID';
  end if;
  if p_plan_type = 'scheduled' and p_start_at is null then
    raise exception using errcode = 'P0001', message = 'PLAN_START_REQUIRED';
  end if;
  if p_end_at is not null and p_start_at is not null and p_end_at < p_start_at then
    raise exception using errcode = 'P0001', message = 'PLAN_TIMING_INVALID';
  end if;
  if p_effective_max_active_plans is null or p_effective_max_active_plans < 1 then
    raise exception using errcode = 'P0001', message = 'PLAN_ACTIVE_LIMIT_INVALID';
  end if;
  if p_effective_max_participants is null
     or p_effective_max_participants < 1
     or p_effective_max_participants > 500 then
    raise exception using errcode = 'P0001', message = 'PLAN_PARTICIPANT_LIMIT_INVALID';
  end if;

  -- A real source row is stronger than an advisory lock. The second
  -- concurrent converter waits here and then observes converted_plan_id.
  if p_source_hangout_id is not null then
    select hs.id, hs.owner_id, hs.status, hs.converted_plan_id
      into v_hangout
    from public.hangout_sessions as hs
    where hs.id = p_source_hangout_id
    for update;

    if not found then
      raise exception using errcode = 'P0001', message = 'HANGOUT_NOT_FOUND';
    end if;
    if v_hangout.owner_id <> p_actor_id then
      raise exception using errcode = 'P0001', message = 'HANGOUT_NOT_AUTHORIZED';
    end if;
    if v_hangout.converted_plan_id is not null then
      v_plan_id := v_hangout.converted_plan_id;
      v_conversation_id := public.reconcile_plan_conversation_members(v_plan_id);
      return query select v_plan_id, v_conversation_id, false;
      return;
    end if;
    if v_hangout.status not in ('active', 'full') then
      raise exception using errcode = 'P0001', message = 'HANGOUT_NOT_CONVERTIBLE';
    end if;
  end if;

  -- Serialize all Plan creation limit decisions for this actor. This prevents
  -- two different request keys from both taking the final available slot.
  perform pg_advisory_xact_lock(hashtextextended('plans:actor:' || p_actor_id::text, 0));
  perform pg_advisory_xact_lock(
    hashtextextended('plans:create:' || p_actor_id::text || ':' || p_request_key, 0)
  );

  select ik.id, ik.status, ik.result
    into v_existing
  from public.idempotency_keys as ik
  where ik.user_id = p_actor_id
    and ik.scope = 'plans.create'
    and ik.key = p_request_key
  for update;

  if found then
    if v_existing.status = 'completed'
       and v_existing.result ? 'plan_id'
       and v_existing.result ? 'conversation_id' then
      v_plan_id := (v_existing.result ->> 'plan_id')::uuid;
      v_conversation_id := (v_existing.result ->> 'conversation_id')::uuid;
      return query select v_plan_id, v_conversation_id, false;
      return;
    end if;
    raise exception using errcode = 'P0001', message = 'PLAN_REQUEST_IN_PROGRESS';
  end if;

  insert into public.idempotency_keys (
    user_id,
    scope,
    key,
    status,
    expires_at
  ) values (
    p_actor_id,
    'plans.create',
    p_request_key,
    'in_progress',
    now() + interval '7 days'
  )
  returning id into v_idempotency_id;

  select count(*)::integer
    into v_active_count
  from public.plans as p
  where p.creator_id = p_actor_id
    and p.status in ('draft', 'inviting', 'polling', 'confirmed');

  if v_active_count >= p_effective_max_active_plans then
    raise exception using errcode = 'P0001', message = 'PLAN_ACTIVE_LIMIT_REACHED';
  end if;

  if p_source_hangout_id is not null then
    -- Accepted UpFor requests are the canonical affirmative response and map
    -- to Going. Pending/Maybe/declined/cancelled requests are not converted.
    select coalesce(array_agg(distinct hr.requester_id), array[]::uuid[])
      into v_candidate_ids
    from public.hangout_requests as hr
    where hr.hangout_session_id = p_source_hangout_id
      and hr.status = 'accepted';
    v_initial_going_ids := v_candidate_ids;
    v_job_kind := 'upfor_converted';
  else
    select coalesce(array_agg(distinct candidate_id), array[]::uuid[])
      into v_candidate_ids
    from unnest(coalesce(p_invitee_ids, array[]::uuid[])) as candidate_id
    where candidate_id <> p_actor_id;

    select coalesce(array_agg(distinct candidate_id), array[]::uuid[])
      into v_initial_going_ids
    from unnest(coalesce(p_initial_going_ids, array[]::uuid[])) as candidate_id
    where candidate_id <> p_actor_id;
    v_job_kind := 'plan_invitation';
  end if;

  if exists (
    select 1
    from unnest(v_initial_going_ids) as initial_id
    where not (initial_id = any(v_candidate_ids))
  ) then
    raise exception using errcode = 'P0001', message = 'PLAN_INITIAL_PARTICIPANT_INVALID';
  end if;

  select cardinality(v_candidate_ids) into v_candidate_count;
  -- Current product semantics count the host toward max_plan_participants.
  if v_candidate_count + 1 > p_effective_max_participants then
    raise exception using errcode = 'P0001', message = 'PLAN_PARTICIPANT_LIMIT_REACHED';
  end if;

  -- ELIGIBILITY, WITH THE UPFOR EXCEPTION.
  --
  -- The plan row does not exist yet, so this cannot use the plan-scoped
  -- predicate; it applies the same rule against p_source_hangout_id directly.
  --
  -- A live block still disqualifies in either direction, checked independently
  -- of everything else. Beyond that: an ordinary Plan needs an active
  -- friendship, exactly as before, while a Plan being converted FROM an UpFor
  -- also accepts anyone the owner accepted onto that exact session.
  --
  -- Note where the candidate ids came from. For a source-UpFor conversion they
  -- were derived above from `hangout_requests.status = 'accepted'` on that
  -- session -- never from p_invitee_ids -- so this cannot admit a stranger the
  -- client named. For an ordinary Plan p_source_hangout_id is null and the
  -- second ground is unreachable, leaving the original rule intact.
  select coalesce(array_agg(candidate_id), array[]::uuid[])
    into v_ineligible_ids
  from unnest(v_candidate_ids) as candidate_id
  where exists (
      select 1
      from public.blocked_users as b
      where (b.blocker_id = p_actor_id and b.blocked_id = candidate_id)
         or (b.blocker_id = candidate_id and b.blocked_id = p_actor_id)
    )
    or (
      not exists (
        select 1
        from public.friendships as f
        where f.ended_at is null
          and (
            (f.user_one_id = p_actor_id and f.user_two_id = candidate_id)
            or (f.user_two_id = p_actor_id and f.user_one_id = candidate_id)
          )
      )
      and not exists (
        select 1
        from public.hangout_requests as hr
        where p_source_hangout_id is not null
          and hr.hangout_session_id = p_source_hangout_id
          and hr.requester_id = candidate_id
          and hr.status = 'accepted'
      )
    );

  if cardinality(v_ineligible_ids) > 0 then
    raise exception using errcode = 'P0001', message = 'PLAN_PARTICIPANT_INELIGIBLE';
  end if;

  v_status := case when p_plan_type = 'poll' then 'polling' else 'inviting' end;

  insert into public.plans (
    creator_id,
    title,
    description,
    plan_type,
    visibility_type,
    status,
    start_at,
    end_at,
    timezone,
    rsvp_deadline,
    max_participants,
    place_type,
    custom_place_text,
    reminder_minutes,
    category,
    source_hangout_id
  ) values (
    p_actor_id,
    btrim(p_title),
    nullif(btrim(coalesce(p_description, '')), ''),
    p_plan_type,
    'invited',
    v_status,
    p_start_at,
    p_end_at,
    coalesce(nullif(btrim(p_timezone), ''), 'UTC'),
    p_rsvp_deadline,
    p_effective_max_participants,
    coalesce(p_place_type, 'custom'),
    nullif(btrim(coalesce(p_custom_place_text, '')), ''),
    p_reminder_minutes,
    p_category,
    p_source_hangout_id
  )
  returning id into v_plan_id;

  insert into public.plan_participants (
    plan_id,
    user_id,
    role,
    rsvp_status,
    invited_by,
    responded_at
  ) values (
    v_plan_id,
    p_actor_id,
    'host',
    'going',
    p_actor_id,
    now()
  );

  insert into public.plan_participants (
    plan_id,
    user_id,
    role,
    rsvp_status,
    invited_by,
    responded_at
  )
  select
    v_plan_id,
    candidate_id,
    'participant',
    case when candidate_id = any(v_initial_going_ids) then 'going' else 'invited' end,
    p_actor_id,
    case when candidate_id = any(v_initial_going_ids) then now() else null end
  from unnest(v_candidate_ids) as candidate_id;

  v_conversation_id := public.reconcile_plan_conversation_members(v_plan_id);

  if p_source_hangout_id is not null then
    update public.hangout_sessions
    set status = 'converted_to_plan',
        converted_plan_id = v_plan_id,
        updated_at = now()
    where id = p_source_hangout_id
      and owner_id = p_actor_id
      and converted_plan_id is null;

    if not found then
      raise exception using errcode = 'P0001', message = 'HANGOUT_CONVERSION_CONFLICT';
    end if;
  end if;

  -- Durable after-commit work. The unique jobs key is the dedupe authority;
  -- notification preferences and delivery remain entirely in the existing
  -- notification subsystem.
  foreach v_recipient_id in array v_candidate_ids loop
    insert into public.jobs (
      job_type,
      payload,
      priority,
      status,
      idempotency_key,
      run_at
    ) values (
      'plans.lifecycle_side_effect',
      jsonb_build_object(
        'kind', v_job_kind,
        'planId', v_plan_id,
        'actorId', p_actor_id,
        'recipientId', v_recipient_id
      ),
      4,
      'queued',
      'plan-invite:' || v_plan_id::text || ':' || v_recipient_id::text,
      now()
    )
    on conflict (idempotency_key)
      where idempotency_key is not null
      do nothing;
  end loop;

  insert into public.jobs (
    job_type,
    payload,
    priority,
    status,
    idempotency_key,
    run_at
  ) values (
    'plans.lifecycle_side_effect',
    jsonb_build_object(
      'kind', 'first_plan_milestone',
      'planId', v_plan_id,
      'actorId', p_actor_id
    ),
    5,
    'queued',
    'plan-milestone:first-plan:' || v_plan_id::text || ':' || p_actor_id::text,
    now()
  )
  on conflict (idempotency_key)
    where idempotency_key is not null
    do nothing;

  update public.idempotency_keys
  set status = 'completed',
      result = jsonb_build_object(
        'plan_id', v_plan_id,
        'conversation_id', v_conversation_id
      ),
      completed_at = now()
  where id = v_idempotency_id;

  return query select v_plan_id, v_conversation_id, true;
end;
$$;
