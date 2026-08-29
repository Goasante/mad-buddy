-- Event Room membership grants the Room's shared history.
--
-- THE BUG. reconcile_event_room_conversation (20260827120000) set a joining
-- member's conversation_members.history_visible_from to their joined_at:
--
--   case when m.role = 'host' then to_timestamp(0) else m.joined_at end
--
-- Both the message loader (lib/messaging/mobile.ts listMessages filters
-- `created_at >= history_visible_from`) and the RLS policy on public.messages
-- honour that column, so a member who joined after a message was sent could
-- never read it. Reproduced against this schema: with one message sent an hour
-- before two members joined, the host saw 1 of 1 and both members saw 0 of 1.
--
-- WHY joined_at WAS WRONG HERE. `history_visible_from default now()` is the
-- right default for a DIRECT conversation, where history is a private exchange
-- between two people and a new participant has no claim on what came before.
-- An Event Room is the opposite: it is one shared room attached to one Event,
-- and the product rule is that being admitted to the Room is what grants the
-- Room's conversation. Groups already model this explicitly through
-- group_settings.history_visibility, where 'full' writes to_timestamp(0)
-- (see app/(app)/group-actions.ts). Event Rooms have no such per-room setting,
-- and the restrictive default was carried over by mistake rather than chosen.
--
-- WHAT THIS DOES NOT DO. It does not weaken the authorization model. Access is
-- still gated by joined conversation membership, which the same function
-- transitions to left/removed/banned the moment Room membership ends -- so a
-- removed or banned member loses the conversation and its history entirely.
-- This only changes WHERE a joined member's readable window starts, and only
-- for conversations whose context_type is 'event_circle'.

-- ---------------------------------------------------------------------------
-- 1. The corrected reconciler.
--
-- Identical to the original except that every joined Room member -- not only
-- the host -- gets to_timestamp(0). Redefined in full rather than patched so
-- the function has one readable definition at its latest version.
-- ---------------------------------------------------------------------------
create or replace function public.reconcile_event_room_conversation(p_room_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner_id uuid;
  v_event_id uuid;
  v_status text;
  v_conversation_id uuid;
  v_existing_type text;
begin
  select c.owner_id, c.event_id, c.status
    into v_owner_id, v_event_id, v_status
  from public.event_circles as c
  where c.id = p_room_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'ROOM_NOT_FOUND';
  end if;

  select c.id, c.conversation_type
    into v_conversation_id, v_existing_type
  from public.conversations as c
  where c.context_type = 'event_circle'
    and c.context_id = p_room_id
  limit 1;

  if v_conversation_id is not null and v_existing_type <> 'event' then
    raise exception using errcode = 'P0001', message = 'ROOM_CONVERSATION_CONTEXT_CONFLICT';
  end if;

  if v_conversation_id is null then
    insert into public.conversations (
      conversation_type, created_by, context_type, context_id, status
    ) values (
      'event', v_owner_id, 'event_circle', p_room_id, 'active'
    )
    returning id into v_conversation_id;
  end if;

  -- Conversation membership is derived from Room membership, which remains the
  -- sole authority.
  --
  -- history_visible_from is to_timestamp(0) for EVERY joined member, not just
  -- the host: admission to the Room is what grants the Room's shared history.
  --
  -- `least(...)` on the conflict path so a member who already had a wider
  -- window never has it narrowed by a later reconcile -- reconcile runs on
  -- every membership and role change, and it must not claw back history a
  -- member could already read.
  insert into public.conversation_members (
    conversation_id, user_id, role, status, history_visible_from
  )
  select
    v_conversation_id,
    m.user_id,
    case m.role
      when 'host' then 'owner'
      when 'co_host' then 'admin'
      when 'moderator' then 'moderator'
      else 'member'
    end,
    'joined',
    to_timestamp(0)
  from public.event_circle_members as m
  where m.event_circle_id = p_room_id
    and m.status = 'joined'
  on conflict (conversation_id, user_id) do update
    set role = excluded.role,
        status = 'joined',
        left_at = null,
        history_visible_from = least(
          public.conversation_members.history_visible_from,
          excluded.history_visible_from
        ),
        updated_at = now();

  -- Anyone no longer a joined Room member loses conversation access. Unchanged:
  -- this is what makes removal and banning actually close the chat, and it is
  -- why widening the readable window above is safe.
  update public.conversation_members as cm
     set status = case
                    when rm.status = 'banned' then 'banned'
                    when rm.status = 'removed' then 'removed'
                    else 'left'
                  end,
         left_at = coalesce(cm.left_at, now()),
         updated_at = now()
    from public.event_circle_members as rm
   where cm.conversation_id = v_conversation_id
     and rm.event_circle_id = p_room_id
     and rm.user_id = cm.user_id
     and rm.status <> 'joined'
     and cm.status = 'joined';

  return v_conversation_id;
end;
$$;

revoke all on function public.reconcile_event_room_conversation(uuid)
  from public, anon, authenticated;
grant execute on function public.reconcile_event_room_conversation(uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- 2. Repair the members who already joined under the old rule.
--
-- Without this the fix would only help future joins, leaving everyone who
-- joined a Room before this migration permanently unable to read the history
-- they are entitled to.
--
-- Scoped strictly to conversations whose context_type is 'event_circle' and to
-- CURRENTLY JOINED members: a removed or banned row keeps whatever window it
-- had, and no other conversation type is touched.
-- ---------------------------------------------------------------------------
update public.conversation_members as cm
   set history_visible_from = to_timestamp(0),
       updated_at = now()
  from public.conversations as c
 where c.id = cm.conversation_id
   and c.context_type = 'event_circle'
   and cm.status = 'joined'
   and cm.history_visible_from > to_timestamp(0);
