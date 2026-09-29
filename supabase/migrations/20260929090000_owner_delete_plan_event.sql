-- Owner-only permanent deletion for Plans and Events.
--
-- Cancellation/end remain non-destructive lifecycle actions. These functions
-- exist for the separate, explicit "Delete" choice and remove generic-context
-- records (conversations/check-ins/drops) that foreign-key cascades cannot see.
--
-- Called only by server-side service-role actions. SECURITY INVOKER is
-- deliberate: the service role already has the needed authority and the
-- function does not need to elevate an ordinary caller.

create or replace function public.delete_owned_plan(
  p_actor_id uuid,
  p_plan_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_creator_id uuid;
begin
  select p.creator_id
    into v_creator_id
  from public.plans as p
  where p.id = p_plan_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'PLAN_NOT_FOUND';
  end if;

  if v_creator_id <> p_actor_id then
    raise exception using errcode = 'P0001', message = 'PLAN_DELETE_FORBIDDEN';
  end if;

  -- Queue all media whose parent will disappear. This includes Plan Chat
  -- message media/documents and contextual Drops; the existing cleanup worker
  -- removes the private storage objects after the transaction commits.
  insert into public.media_deletion_queue (media_asset_id, reason)
  select distinct media_id, 'parent_deleted'
  from (
    select m.media_id
    from public.messages as m
    join public.conversations as c on c.id = m.conversation_id
    where c.context_type = 'plan'
      and c.context_id = p_plan_id
      and m.media_id is not null

    union

    select mf.media_id
    from public.message_files as mf
    join public.messages as m on m.id = mf.message_id
    join public.conversations as c on c.id = m.conversation_id
    where c.context_type = 'plan'
      and c.context_id = p_plan_id

    union

    select d.media_id
    from public.muddy_drops as d
    where (
        (d.context_type = 'plan' and d.context_id = p_plan_id)
        or (d.action_type = 'join_plan' and d.action_target_id = p_plan_id)
      )
      and d.media_id is not null
  ) as plan_media(media_id)
  on conflict (media_asset_id) do nothing;

  -- Generic context/target ids have no FK back to plans, so remove them
  -- explicitly before the Plan row is deleted.
  delete from public.check_ins
  where context_type = 'plan' and context_id = p_plan_id;

  delete from public.moment_audience_targets
  where target_type = 'plan' and target_id = p_plan_id;

  delete from public.drop_audience_targets
  where target_type = 'plan' and target_id = p_plan_id;

  delete from public.hidden_content
  where content_type = 'plan' and content_id = p_plan_id;

  delete from public.muddy_drops
  where (context_type = 'plan' and context_id = p_plan_id)
     or (action_type = 'join_plan' and action_target_id = p_plan_id);

  -- A Plan conversation points at the Plan through generic context_id, not an
  -- FK. Deleting it cascades messages, reactions, member rows and preferences.
  delete from public.conversations
  where context_type = 'plan' and context_id = p_plan_id;

  -- Participants, polls/options/votes and structured message refs are FK
  -- children and cascade here.
  delete from public.plans
  where id = p_plan_id and creator_id = p_actor_id;

  return true;
end;
$$;

create or replace function public.delete_owned_event(
  p_actor_id uuid,
  p_event_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_host_id uuid;
  v_cover_media_id uuid;
  v_room_ids uuid[] := array[]::uuid[];
begin
  select e.host_id, e.cover_media_id
    into v_host_id, v_cover_media_id
  from public.events as e
  where e.id = p_event_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'EVENT_NOT_FOUND';
  end if;

  if v_host_id <> p_actor_id then
    raise exception using errcode = 'P0001', message = 'EVENT_DELETE_FORBIDDEN';
  end if;

  select coalesce(array_agg(c.id), array[]::uuid[])
    into v_room_ids
  from public.event_circles as c
  where c.event_id = p_event_id;

  -- Cover, Event/Room chat media, document attachments and contextual Drop
  -- media all follow the parent into the existing deletion queue.
  insert into public.media_deletion_queue (media_asset_id, reason)
  select distinct media_id, 'parent_deleted'
  from (
    select v_cover_media_id as media_id
    where v_cover_media_id is not null

    union

    select m.media_id
    from public.messages as m
    join public.conversations as c on c.id = m.conversation_id
    where (
        (c.context_type = 'event' and c.context_id = p_event_id)
        or (c.context_type = 'event_circle' and c.context_id = any(v_room_ids))
      )
      and m.media_id is not null

    union

    select mf.media_id
    from public.message_files as mf
    join public.messages as m on m.id = mf.message_id
    join public.conversations as c on c.id = m.conversation_id
    where (c.context_type = 'event' and c.context_id = p_event_id)
       or (c.context_type = 'event_circle' and c.context_id = any(v_room_ids))

    union

    select d.media_id
    from public.muddy_drops as d
    where (
        (d.context_type = 'event' and d.context_id = p_event_id)
        or (d.context_type = 'event_circle' and d.context_id = any(v_room_ids))
      )
      and d.media_id is not null
  ) as event_media(media_id)
  on conflict (media_asset_id) do nothing;

  -- These references are generic ids rather than foreign keys.
  delete from public.check_ins
  where context_type = 'event' and context_id = p_event_id;

  delete from public.invite_links
  where invite_type = 'event' and context_id = p_event_id;

  delete from public.moment_audience_targets
  where target_type = 'event_circle' and target_id = any(v_room_ids);

  delete from public.drop_audience_targets
  where target_type = 'event_circle' and target_id = any(v_room_ids);

  delete from public.muddy_drops
  where (context_type = 'event' and context_id = p_event_id)
     or (context_type = 'event_circle' and context_id = any(v_room_ids));

  -- Event and Room conversations also use generic context ids.
  delete from public.conversations
  where (context_type = 'event' and context_id = p_event_id)
     or (context_type = 'event_circle' and context_id = any(v_room_ids));

  -- RSVP, audience/admin/location/update/Room rows and structured message refs
  -- are FK children. Safe Arrival and Linkr references use ON DELETE SET NULL.
  delete from public.events
  where id = p_event_id and host_id = p_actor_id;

  return true;
end;
$$;

-- Postgres grants EXECUTE on new functions to PUBLIC by default. These are
-- private server lifecycle primitives, not browser-callable RPC endpoints.
revoke all on function public.delete_owned_plan(uuid, uuid) from public, anon, authenticated;
revoke all on function public.delete_owned_event(uuid, uuid) from public, anon, authenticated;

grant execute on function public.delete_owned_plan(uuid, uuid) to service_role;
grant execute on function public.delete_owned_event(uuid, uuid) to service_role;
