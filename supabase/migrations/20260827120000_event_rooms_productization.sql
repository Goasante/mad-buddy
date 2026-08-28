-- Event Rooms productization: authority the product promise already implied.
--
-- Event Rooms are the user-facing name for event_circles. The internal tables
-- keep their names -- renaming stable production architecture for cosmetic
-- consistency buys nothing and risks everything.
--
-- WHAT WAS ACTUALLY BROKEN, audited before writing a line of this:
--
--   1. join_mode = 'community' meant ANYONE COULD JOIN. resolveJoinEventCircle
--      had no branch for it at all, so it fell through to `allowed`. The UI was
--      about to offer "Group members" as a join mode while the backend enforced
--      nothing. Fixed here by recording WHICH groups are eligible
--      (event_circle_group_targets) and verifying live membership server-side.
--
--   2. join_mode = 'invite' was satisfied by ANY valid circle_join token. So
--      "invite only" meant "anyone holding a QR", which is the opposite of what
--      it says. Fixed here with real invitation rows (event_circle_invitations)
--      so an invite is a fact about a person, not about possession of a string.
--
--   3. Rooms had NO CHAT. context_type 'event_circle' has existed in the
--      conversations enum since the messaging migration and nothing ever wrote
--      it. Rooms got announcements and a member list and no way to talk.
--
--   4. Membership was written in two places that could disagree: a room member
--      row and (once chat exists) a conversation member row, with no
--      transaction around them. Same class of bug the canonical Plan lifecycle
--      migration fixed for Plans; the same shape of fix is used here.
--
-- Everything below is additive. No table is renamed or dropped, no existing row
-- changes meaning, and every new column has a default that preserves current
-- behaviour for rows written before this migration.

-- ---------------------------------------------------------------------------
-- 1. Room discoverability -- the "Show in event" switch needs somewhere to live
--
-- Defaults to true so every existing Room keeps behaving exactly as it does
-- today. A Room that is not listed is still reachable by QR or invitation --
-- this controls the Event page listing, not access. Those are different
-- questions and conflating them would make "hide from the page" silently mean
-- "revoke everyone's access".
-- ---------------------------------------------------------------------------
alter table public.event_circles
  add column if not exists listed_in_event boolean not null default true;

-- The Rooms tab reads exactly this: listed, non-archived rooms for one event.
create index if not exists event_circles_event_listed_idx
  on public.event_circles(event_id, status)
  where listed_in_event;

-- ---------------------------------------------------------------------------
-- 2. Room invitations -- so "invite only" means invited
--
-- A row here is the invitation. It is created by someone with authority over
-- the Room and it names the person invited. Possession of a token is no longer
-- sufficient for join_mode 'invite', which is what that mode always claimed.
--
-- Kept separate from event_circle_members deliberately: a membership row with
-- status 'invited' would make "is this person a member" ambiguous everywhere it
-- is currently asked, and every existing count would silently start including
-- people who never accepted.
-- ---------------------------------------------------------------------------
create table if not exists public.event_circle_invitations (
  id uuid primary key default gen_random_uuid(),
  event_circle_id uuid not null references public.event_circles(id) on delete cascade,
  invited_user_id uuid not null references auth.users(id) on delete cascade,
  invited_by uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Re-inviting somebody updates their invitation rather than stacking a
  -- second one, so "was this person invited" has exactly one answer.
  constraint event_circle_invitations_unique unique (event_circle_id, invited_user_id)
);

create index if not exists event_circle_invitations_user_idx
  on public.event_circle_invitations(invited_user_id, status);
create index if not exists event_circle_invitations_circle_idx
  on public.event_circle_invitations(event_circle_id, status);

-- ---------------------------------------------------------------------------
-- 3. Group targets -- which Groups a 'community' Room actually admits
--
-- A Group in this product is a conversation (conversation_type 'group' with a
-- group_settings row), not a separate table. So a target references the
-- conversation, and eligibility is "you are a joined member of that
-- conversation right now" -- evaluated at join time, never cached.
-- ---------------------------------------------------------------------------
create table if not exists public.event_circle_group_targets (
  id uuid primary key default gen_random_uuid(),
  event_circle_id uuid not null references public.event_circles(id) on delete cascade,
  group_conversation_id uuid not null references public.conversations(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint event_circle_group_targets_unique unique (event_circle_id, group_conversation_id)
);

create index if not exists event_circle_group_targets_circle_idx
  on public.event_circle_group_targets(event_circle_id);

-- ---------------------------------------------------------------------------
-- 4. Room Notice reactions
--
-- Room Notices live in event_announcements. Their reactions get their own table
-- rather than reusing event_update_reactions, whose foreign key points at
-- event_updates -- a different table with a different lifecycle. Pointing one
-- reaction table at two parents would need a nullable FK pair and a check
-- constraint to keep them exclusive, and would break the cascade that makes
-- deleting a notice delete its reactions.
--
-- The unique constraint is the product rule, same as Event Updates: reacting
-- again replaces your reaction, so counts count people, not taps.
-- ---------------------------------------------------------------------------
create table if not exists public.event_announcement_reactions (
  id uuid primary key default gen_random_uuid(),
  event_announcement_id uuid not null references public.event_announcements(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  reaction_type text not null check (reaction_type in ('heart', 'fire', 'applause', 'wow')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint event_announcement_reactions_unique unique (event_announcement_id, user_id)
);

create index if not exists event_announcement_reactions_announcement_idx
  on public.event_announcement_reactions(event_announcement_id);

-- ---------------------------------------------------------------------------
-- 5. One canonical conversation per Room
--
-- The partial unique index in the messaging migration covers conversation_type
-- in ('plan','event') for (context_type, context_id). An Event Room
-- conversation is conversation_type 'event' with context_type 'event_circle',
-- so it is already covered -- but only for that pair. This asserts the
-- invariant on the context pair itself so a second conversation for one Room
-- cannot be created by any path, including a future one.
-- ---------------------------------------------------------------------------
create unique index if not exists conversations_event_circle_unique
  on public.conversations(context_id)
  where context_type = 'event_circle';

-- ---------------------------------------------------------------------------
-- 6. Row level security
--
-- Every server path runs through the service role, which bypasses RLS. These
-- policies exist so the tables are safe if ever read with an anon or
-- authenticated key. "Nothing calls it with that key today" is a fact about
-- today, not a control.
-- ---------------------------------------------------------------------------
alter table public.event_circle_invitations enable row level security;
alter table public.event_circle_group_targets enable row level security;
alter table public.event_announcement_reactions enable row level security;

-- You may see that YOU were invited. You may not enumerate who else was --
-- the guest list of a private Room is not public information.
create policy "event circle invitations visible to invitee" on public.event_circle_invitations
  for select using (auth.uid() = invited_user_id);

-- Who a Room admits is configuration, readable by its joined members.
create policy "event circle group targets visible to members" on public.event_circle_group_targets
  for select using (
    exists (
      select 1 from public.event_circle_members m
      where m.event_circle_id = event_circle_group_targets.event_circle_id
        and m.user_id = auth.uid()
        and m.status = 'joined'
    )
  );

-- Reactions are visible to people who can see the notice they belong to.
create policy "event announcement reactions visible to room members" on public.event_announcement_reactions
  for select using (
    exists (
      select 1
      from public.event_announcements a
      join public.event_circle_members m
        on m.event_circle_id = a.event_circle_id
      where a.id = event_announcement_reactions.event_announcement_id
        and m.user_id = auth.uid()
        and m.status = 'joined'
    )
  );

-- ---------------------------------------------------------------------------
-- 7. THE LIFECYCLE AUTHORITY
--
-- One function reconciles a Room's conversation and its membership. Everything
-- that changes who is in a Room calls it, so Room membership and conversation
-- membership cannot drift apart -- there is no second path that writes one
-- without the other.
--
-- Membership rows are transitioned, never deleted: leaving and rejoining
-- preserves mute settings, read state and history_visible_from, and a removal
-- stays on the record.
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

  -- A conversation already bound to this Room under another type means two
  -- features disagree about what this row is. Fail loudly rather than writing
  -- Room members into it.
  if v_conversation_id is not null and v_existing_type <> 'event' then
    raise exception using errcode = 'P0001', message = 'ROOM_CONVERSATION_CONTEXT_CONFLICT';
  end if;

  if v_conversation_id is null then
    insert into public.conversations (
      conversation_type,
      created_by,
      context_type,
      context_id,
      status
    ) values (
      'event',
      v_owner_id,
      'event_circle',
      p_room_id,
      'active'
    )
    returning id into v_conversation_id;
  end if;

  -- Conversation membership is derived from Room membership, which is the sole
  -- authority. Joined Room members are joined here; everyone else is transitioned
  -- out. This is what makes a removal or a ban actually close the chat.
  --
  -- history_visible_from is set to the epoch for the owner only. Members see
  -- the room from when they joined, which is the messaging default.
  insert into public.conversation_members (
    conversation_id,
    user_id,
    role,
    status,
    history_visible_from
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
    case when m.role = 'host' then to_timestamp(0) else m.joined_at end
  from public.event_circle_members as m
  where m.event_circle_id = p_room_id
    and m.status = 'joined'
  on conflict (conversation_id, user_id) do update
    set role = excluded.role,
        status = 'joined',
        left_at = null,
        updated_at = now();

  -- Anyone no longer a joined Room member loses conversation access. Their row
  -- is transitioned rather than deleted so their read state survives a rejoin,
  -- and a ban is recorded as a ban.
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

-- ---------------------------------------------------------------------------
-- 8. Create a Room, its conversation and its host membership -- atomically
--
-- Previously three separate statements from the action layer, any of which
-- could fail leaving a Room with no host or no chat.
-- ---------------------------------------------------------------------------
create or replace function public.create_event_room(
  p_owner_id uuid,
  p_event_id uuid,
  p_name text,
  p_description text,
  p_join_mode text,
  p_max_members integer,
  p_listed boolean,
  p_group_conversation_ids uuid[] default '{}'::uuid[]
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_room_id uuid;
  v_group_id uuid;
begin
  if p_join_mode not in ('invite', 'check_in', 'qr', 'community') then
    raise exception using errcode = 'P0001', message = 'ROOM_INVALID_JOIN_MODE';
  end if;

  -- A Group-gated Room with no Groups selected would admit nobody while
  -- looking configured. Refuse it at the authority rather than shipping a Room
  -- that silently cannot be joined.
  if p_join_mode = 'community'
     and coalesce(array_length(p_group_conversation_ids, 1), 0) = 0 then
    raise exception using errcode = 'P0001', message = 'ROOM_GROUP_TARGET_REQUIRED';
  end if;

  insert into public.event_circles (
    event_id, owner_id, name, description, join_mode,
    status, max_members, listed_in_event
  ) values (
    p_event_id, p_owner_id, p_name, p_description, p_join_mode,
    'open', p_max_members, coalesce(p_listed, true)
  )
  returning id into v_room_id;

  insert into public.event_circle_members (
    event_circle_id, user_id, role, status
  ) values (
    v_room_id, p_owner_id, 'host', 'joined'
  );

  -- Only Groups the creator is actually a joined member of may be targeted.
  -- Otherwise a host could grant Room access to a Group they have no standing
  -- in, using nothing but its id.
  if coalesce(array_length(p_group_conversation_ids, 1), 0) > 0 then
    foreach v_group_id in array p_group_conversation_ids loop
      if not exists (
        select 1
        from public.conversation_members as gm
        join public.conversations as gc on gc.id = gm.conversation_id
        where gm.conversation_id = v_group_id
          and gm.user_id = p_owner_id
          and gm.status = 'joined'
          and gc.conversation_type = 'group'
      ) then
        raise exception using errcode = 'P0001', message = 'ROOM_GROUP_TARGET_FORBIDDEN';
      end if;

      insert into public.event_circle_group_targets (event_circle_id, group_conversation_id)
      values (v_room_id, v_group_id)
      on conflict do nothing;
    end loop;
  end if;

  perform public.reconcile_event_room_conversation(v_room_id);

  return v_room_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Join a Room -- one transaction, idempotent, capacity enforced under lock
--
-- Capacity is counted INSIDE the row lock taken by reconcile, so two
-- simultaneous joins cannot both observe "one seat left" and both take it.
-- Eligibility itself is decided by the caller (lib/events/rules.ts), which owns
-- the product rules; this function enforces the parts that need the database:
-- atomicity, capacity, and membership reconciliation.
-- ---------------------------------------------------------------------------
create or replace function public.join_event_room(
  p_room_id uuid,
  p_user_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_max_members integer;
  v_status text;
  v_member_status text;
  v_count integer;
  v_conversation_id uuid;
begin
  select c.max_members, c.status
    into v_max_members, v_status
  from public.event_circles as c
  where c.id = p_room_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'ROOM_NOT_FOUND';
  end if;

  if v_status not in ('open', 'active') then
    raise exception using errcode = 'P0001', message = 'ROOM_CLOSED';
  end if;

  select m.status into v_member_status
  from public.event_circle_members as m
  where m.event_circle_id = p_room_id and m.user_id = p_user_id;

  -- A ban is terminal. Re-checked here and not only in the caller, because
  -- this function is the last gate before the write.
  if v_member_status = 'banned' then
    raise exception using errcode = 'P0001', message = 'ROOM_BANNED';
  end if;

  -- Already joined is success, not an error: a retried join must not fail and
  -- must not create a second membership.
  if v_member_status is distinct from 'joined' then
    select count(*) into v_count
    from public.event_circle_members as m
    where m.event_circle_id = p_room_id and m.status = 'joined';

    if v_count >= v_max_members then
      raise exception using errcode = 'P0001', message = 'ROOM_FULL';
    end if;

    insert into public.event_circle_members (
      event_circle_id, user_id, role, status, joined_at, left_at
    ) values (
      p_room_id, p_user_id, 'member', 'joined', now(), null
    )
    on conflict (event_circle_id, user_id) do update
      set status = 'joined',
          joined_at = now(),
          left_at = null;
  end if;

  -- Accepting an invitation consumes it, so a revoked-then-reissued invite is
  -- distinguishable from one that was never used.
  update public.event_circle_invitations
     set status = 'accepted', updated_at = now()
   where event_circle_id = p_room_id
     and invited_user_id = p_user_id
     and status = 'pending';

  v_conversation_id := public.reconcile_event_room_conversation(p_room_id);
  return v_conversation_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. Leave / remove / ban -- membership and chat access move together
-- ---------------------------------------------------------------------------
create or replace function public.set_event_room_membership(
  p_room_id uuid,
  p_user_id uuid,
  p_status text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_conversation_id uuid;
begin
  if p_status not in ('left', 'removed', 'banned') then
    raise exception using errcode = 'P0001', message = 'ROOM_INVALID_MEMBER_STATUS';
  end if;

  update public.event_circle_members
     set status = p_status,
         left_at = now()
   where event_circle_id = p_room_id
     and user_id = p_user_id;

  -- A banned person must not hold a live invitation to walk back in with.
  if p_status = 'banned' then
    update public.event_circle_invitations
       set status = 'revoked', updated_at = now()
     where event_circle_id = p_room_id
       and invited_user_id = p_user_id
       and status = 'pending';
  end if;

  v_conversation_id := public.reconcile_event_room_conversation(p_room_id);
  return v_conversation_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 11. Role changes propagate to chat moderation powers
-- ---------------------------------------------------------------------------
create or replace function public.set_event_room_role(
  p_room_id uuid,
  p_user_id uuid,
  p_role text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_conversation_id uuid;
begin
  if p_role not in ('co_host', 'moderator', 'member') then
    raise exception using errcode = 'P0001', message = 'ROOM_INVALID_ROLE';
  end if;

  -- The host role is owned by event_circles.owner_id and is not assignable
  -- here; promoting somebody to host would create a second owner.
  update public.event_circle_members
     set role = p_role
   where event_circle_id = p_room_id
     and user_id = p_user_id
     and status = 'joined'
     and role <> 'host';

  v_conversation_id := public.reconcile_event_room_conversation(p_room_id);
  return v_conversation_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 12. Archive a Room -- read-only, without destroying anything
--
-- Archiving keeps every member and every message. It closes the conversation
-- so no new message can be written, and leaves history readable. Nobody's
-- content is deleted because an Event ended.
-- ---------------------------------------------------------------------------
create or replace function public.archive_event_room(
  p_room_id uuid,
  p_archives_at timestamptz
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_conversation_id uuid;
begin
  update public.event_circles
     set status = 'archived',
         closes_at = now(),
         archives_at = p_archives_at,
         updated_at = now()
   where id = p_room_id;

  if not found then
    raise exception using errcode = 'P0001', message = 'ROOM_NOT_FOUND';
  end if;

  v_conversation_id := public.reconcile_event_room_conversation(p_room_id);

  -- 'archived' is the conversation status that canSendMessage already refuses
  -- to write to, so an archived Room is read-only through the existing
  -- messaging authority rather than a new rule that could be forgotten.
  update public.conversations
     set status = 'archived',
         updated_at = now()
   where id = v_conversation_id;

  return v_conversation_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 13. Ending an Event moves its Rooms toward closing -- deterministically
--
-- Ending an Event does NOT delete its Rooms and does not archive them
-- instantly. Rooms move to 'closing': still readable, still writable for the
-- people already in them, closed to new members. The existing archive sweep
-- takes them the rest of the way. An after-party conversation should not die
-- the moment the calendar says the Event is over.
-- ---------------------------------------------------------------------------
create or replace function public.close_event_rooms_for_event(p_event_id uuid)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_room record;
  v_count integer := 0;
begin
  for v_room in
    select id
    from public.event_circles
    where event_id = p_event_id
      and status in ('open', 'active')
    for update
  loop
    update public.event_circles
       set status = 'closing',
           closes_at = coalesce(closes_at, now()),
           updated_at = now()
     where id = v_room.id;

    perform public.reconcile_event_room_conversation(v_room.id);
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- 14. Grants
--
-- security invoker + service_role only. These functions assume the caller has
-- already checked authority; handing them to `authenticated` would let a client
-- call join_event_room directly and bypass every product rule in the action
-- layer.
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on table
  public.event_circle_invitations,
  public.event_circle_group_targets,
  public.event_announcement_reactions
to service_role;

grant select, insert, update on table
  public.event_circles,
  public.event_circle_members,
  public.event_announcements,
  public.conversations,
  public.conversation_members
to service_role;

revoke all on function public.reconcile_event_room_conversation(uuid)
  from public, anon, authenticated;
grant execute on function public.reconcile_event_room_conversation(uuid)
  to service_role;

revoke all on function public.create_event_room(uuid, uuid, text, text, text, integer, boolean, uuid[])
  from public, anon, authenticated;
grant execute on function public.create_event_room(uuid, uuid, text, text, text, integer, boolean, uuid[])
  to service_role;

revoke all on function public.join_event_room(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.join_event_room(uuid, uuid)
  to service_role;

revoke all on function public.set_event_room_membership(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.set_event_room_membership(uuid, uuid, text)
  to service_role;

revoke all on function public.set_event_room_role(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.set_event_room_role(uuid, uuid, text)
  to service_role;

revoke all on function public.archive_event_room(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.archive_event_room(uuid, timestamptz)
  to service_role;

revoke all on function public.close_event_rooms_for_event(uuid)
  from public, anon, authenticated;
grant execute on function public.close_event_rooms_for_event(uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- 15. Backfill -- existing Rooms get their conversation
--
-- Every Room that predates this migration is reconciled once, so Room chat
-- works for rooms created before chat existed. Idempotent: reconcile creates a
-- conversation only when one is missing.
-- ---------------------------------------------------------------------------
do $$
declare
  v_room record;
begin
  for v_room in
    select id from public.event_circles where status <> 'deleted'
  loop
    begin
      perform public.reconcile_event_room_conversation(v_room.id);
    exception when others then
      -- One malformed legacy Room must not abort the whole migration.
      raise warning 'Skipped room % during backfill: %', v_room.id, sqlerrm;
    end;
  end loop;
end;
$$;
