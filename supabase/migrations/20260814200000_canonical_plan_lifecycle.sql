-- Canonical, transaction-safe Plan lifecycle and Plan Chat membership.
--
-- This migration deliberately does not alter notifications. Plan invitation
-- work is written to the existing idempotent jobs queue in the same
-- transaction as the Plan, then delivered by the canonical notification
-- service after commit.

-- One UpFor session may become at most one Plan, and one Plan may be the
-- conversion result of at most one UpFor session.
create unique index if not exists plans_source_hangout_unique
  on public.plans(source_hangout_id)
  where source_hangout_id is not null;

create unique index if not exists hangout_sessions_converted_plan_unique
  on public.hangout_sessions(converted_plan_id)
  where converted_plan_id is not null;

-- The reverse link already has a foreign key. Add the missing forward link,
-- preserving the Plan if a temporary UpFor session is ever deleted.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'plans_source_hangout_fk'
      and conrelid = 'public.plans'::regclass
  ) then
    alter table public.plans
      add constraint plans_source_hangout_fk
      foreign key (source_hangout_id)
      references public.hangout_sessions(id)
      on delete set null;
  end if;
end;
$$;

-- Create/reuse the canonical Plan conversation and make active conversation
-- membership match the Plan participant authority. Existing membership rows
-- are transitioned rather than deleted, preserving history and user settings.
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
    and exists (
      select 1
      from public.friendships as f
      where f.ended_at is null
        and (
          (f.user_one_id = v_creator_id and f.user_two_id = pp.user_id)
          or (f.user_two_id = v_creator_id and f.user_one_id = pp.user_id)
        )
    )
    and not exists (
      select 1
      from public.blocked_users as b
      where (b.blocker_id = v_creator_id and b.blocked_id = pp.user_id)
         or (b.blocker_id = pp.user_id and b.blocked_id = v_creator_id)
    )
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
        and exists (
          select 1
          from public.friendships as f
          where f.ended_at is null
            and (
              (f.user_one_id = v_creator_id and f.user_two_id = pp.user_id)
              or (f.user_two_id = v_creator_id and f.user_one_id = pp.user_id)
            )
        )
        and not exists (
          select 1
          from public.blocked_users as b
          where (b.blocker_id = v_creator_id and b.blocked_id = pp.user_id)
             or (b.blocker_id = pp.user_id and b.blocked_id = v_creator_id)
        )
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

-- Atomically create a normal Plan or convert an UpFor session. The caller is
-- service-role code that derives actor and effective limits from the session;
-- the function is not executable by browser roles.
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

  select coalesce(array_agg(candidate_id), array[]::uuid[])
    into v_ineligible_ids
  from unnest(v_candidate_ids) as candidate_id
  where not exists (
      select 1
      from public.friendships as f
      where f.ended_at is null
        and (
          (f.user_one_id = p_actor_id and f.user_two_id = candidate_id)
          or (f.user_two_id = p_actor_id and f.user_one_id = candidate_id)
        )
    )
    or exists (
      select 1
      from public.blocked_users as b
      where (b.blocker_id = p_actor_id and b.blocked_id = candidate_id)
         or (b.blocker_id = candidate_id and b.blocked_id = p_actor_id)
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

-- RSVP and conversation authorization transition atomically. This prevents a
-- declined/leaving participant from retaining a joined Plan Chat membership
-- between two separately committed application calls.
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
    if not exists (
      select 1
      from public.friendships as f
      where f.ended_at is null
        and (
          (f.user_one_id = v_plan.creator_id and f.user_two_id = p_actor_id)
          or (f.user_two_id = v_plan.creator_id and f.user_one_id = p_actor_id)
        )
    ) or exists (
      select 1
      from public.blocked_users as b
      where (b.blocker_id = v_plan.creator_id and b.blocked_id = p_actor_id)
         or (b.blocker_id = p_actor_id and b.blocked_id = v_plan.creator_id)
    ) then
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

-- Host/co-host participant additions are capacity-checked, eligibility-checked
-- and invitation-work-enqueued in the same transaction.
create or replace function public.add_plan_participants(
  p_actor_id uuid,
  p_plan_id uuid,
  p_participant_ids uuid[],
  p_effective_max_participants integer
)
returns table (
  added_count integer,
  conversation_id uuid
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_plan record;
  v_candidate_ids uuid[] := array[]::uuid[];
  v_ineligible_ids uuid[] := array[]::uuid[];
  v_added_ids uuid[] := array[]::uuid[];
  v_current_count integer;
  v_conversation_id uuid;
  v_recipient_id uuid;
begin
  if p_effective_max_participants is null
     or p_effective_max_participants < 1
     or p_effective_max_participants > 500 then
    raise exception using errcode = 'P0001', message = 'PLAN_PARTICIPANT_LIMIT_INVALID';
  end if;

  select p.creator_id, p.status
    into v_plan
  from public.plans as p
  where p.id = p_plan_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'PLAN_NOT_FOUND';
  end if;
  if v_plan.status in ('cancelled', 'completed', 'expired') then
    raise exception using errcode = 'P0001', message = 'PLAN_CLOSED';
  end if;
  if p_actor_id <> v_plan.creator_id and not exists (
    select 1
    from public.plan_participants as pp
    where pp.plan_id = p_plan_id
      and pp.user_id = p_actor_id
      and pp.role in ('host', 'co_host')
      and pp.rsvp_status <> 'removed'
  ) then
    raise exception using errcode = 'P0001', message = 'PLAN_NOT_AUTHORIZED';
  end if;

  select coalesce(array_agg(distinct candidate_id), array[]::uuid[])
    into v_candidate_ids
  from unnest(coalesce(p_participant_ids, array[]::uuid[])) as candidate_id
  where candidate_id <> v_plan.creator_id;

  if cardinality(v_candidate_ids) = 0 then
    raise exception using errcode = 'P0001', message = 'PLAN_PARTICIPANTS_REQUIRED';
  end if;

  select coalesce(array_agg(candidate_id), array[]::uuid[])
    into v_ineligible_ids
  from unnest(v_candidate_ids) as candidate_id
  where not exists (
      select 1
      from public.friendships as f
      where f.ended_at is null
        and (
          (f.user_one_id = v_plan.creator_id and f.user_two_id = candidate_id)
          or (f.user_two_id = v_plan.creator_id and f.user_one_id = candidate_id)
        )
    )
    or exists (
      select 1
      from public.blocked_users as b
      where (b.blocker_id = v_plan.creator_id and b.blocked_id = candidate_id)
         or (b.blocker_id = candidate_id and b.blocked_id = v_plan.creator_id)
    );

  if cardinality(v_ineligible_ids) > 0 then
    raise exception using errcode = 'P0001', message = 'PLAN_PARTICIPANT_INELIGIBLE';
  end if;

  select count(*)::integer
    into v_current_count
  from public.plan_participants as pp
  where pp.plan_id = p_plan_id
    and pp.rsvp_status <> 'removed';

  if v_current_count + (
    select count(*)
    from unnest(v_candidate_ids) as candidate_id
    where not exists (
      select 1
      from public.plan_participants as pp
      where pp.plan_id = p_plan_id
        and pp.user_id = candidate_id
        and pp.rsvp_status <> 'removed'
    )
  ) > p_effective_max_participants then
    raise exception using errcode = 'P0001', message = 'PLAN_PARTICIPANT_LIMIT_REACHED';
  end if;

  with inserted as (
    insert into public.plan_participants (
      plan_id,
      user_id,
      role,
      rsvp_status,
      invited_by
    )
    select p_plan_id, candidate_id, 'participant', 'invited', p_actor_id
    from unnest(v_candidate_ids) as candidate_id
    on conflict (plan_id, user_id) do update
      set role = 'participant',
          rsvp_status = 'invited',
          invited_by = excluded.invited_by,
          responded_at = null,
          updated_at = now()
      -- Reuse the canonical participant row when a host deliberately adds a
      -- previously removed Muddy again. Existing active invitations and
      -- responses remain untouched and do not produce another side effect.
      where public.plan_participants.rsvp_status = 'removed'
    returning user_id
  )
  select coalesce(array_agg(user_id), array[]::uuid[])
    into v_added_ids
  from inserted;

  v_conversation_id := public.reconcile_plan_conversation_members(p_plan_id);

  foreach v_recipient_id in array v_added_ids loop
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
        'kind', 'plan_invitation',
        'planId', p_plan_id,
        'actorId', p_actor_id,
        'recipientId', v_recipient_id
      ),
      4,
      'queued',
      'plan-invite:' || p_plan_id::text || ':' || v_recipient_id::text,
      now()
    )
    on conflict (idempotency_key)
      where idempotency_key is not null
      do nothing;
  end loop;

  return query select cardinality(v_added_ids), v_conversation_id;
end;
$$;

-- These functions intentionally remain SECURITY INVOKER. Grant only the
-- table operations their service-role caller needs; browser roles receive no
-- new table privileges and still cannot execute the functions. Explicit
-- grants also make a clean CLI migration chain behave like the hosted
-- Supabase project, whose service role already owns canonical server writes.
grant select on table
  public.plans,
  public.plan_participants,
  public.hangout_sessions,
  public.hangout_requests,
  public.friendships,
  public.blocked_users,
  public.conversations,
  public.conversation_members,
  public.messages,
  public.jobs,
  public.idempotency_keys
to service_role;

grant insert on table
  public.plans,
  public.plan_participants,
  public.conversations,
  public.conversation_members,
  public.messages,
  public.jobs,
  public.idempotency_keys
to service_role;

grant update on table
  public.plans,
  public.plan_participants,
  public.hangout_sessions,
  public.conversations,
  public.conversation_members,
  public.idempotency_keys
to service_role;

revoke all on function public.reconcile_plan_conversation_members(uuid)
  from public, anon, authenticated;
grant execute on function public.reconcile_plan_conversation_members(uuid)
  to service_role;

revoke all on function public.create_plan_lifecycle(
  uuid, text, text, text, text, timestamptz, timestamptz, text,
  timestamptz, text, text, integer, text, uuid[], uuid[], uuid,
  integer, integer
) from public, anon, authenticated;
grant execute on function public.create_plan_lifecycle(
  uuid, text, text, text, text, timestamptz, timestamptz, text,
  timestamptz, text, text, integer, text, uuid[], uuid[], uuid,
  integer, integer
) to service_role;

revoke all on function public.set_plan_participant_rsvp(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.set_plan_participant_rsvp(uuid, uuid, text)
  to service_role;

revoke all on function public.add_plan_participants(uuid, uuid, uuid[], integer)
  from public, anon, authenticated;
grant execute on function public.add_plan_participants(uuid, uuid, uuid[], integer)
  to service_role;
