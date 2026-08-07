-- Groups 2.0 — Stage 3B: canonical Owner / Admin / Member role architecture.
--
-- The role model ALREADY EXISTS: `conversation_members.role` is
-- ('owner','admin','moderator','member'), every group creation writes 'owner',
-- and the pure predicates in lib/messaging/rules.ts already gate invites and
-- posting. No second membership table is introduced, and none is needed.
--
-- What is missing is everything that CHANGES a role. Three defects:
--
--   1. SELF-PROMOTION IS POSSIBLE. The policy "conversation members update own
--      row" allows a member to UPDATE their own row with no column
--      restriction, so `role = 'owner'` on your own membership is a legal
--      client write. That is a privilege-escalation hole, not a style issue.
--
--   2. OWNERSHIP CANNOT BE TRANSFERRED. `leaveGroupAction` already refuses to
--      let an owner leave "until ownership is transferred" — but no transfer
--      path exists anywhere in the product, so that guard is a dead end.
--
--   3. NOTHING GUARANTEES ONE OWNER. Two concurrent transfers could leave a
--      group with zero owners or two.
--
-- This migration fixes all three at the database, so the guarantees hold even
-- if a future action forgets them.

-- ---------------------------------------------------------------------------
-- 1. Close the self-promotion hole.
-- ---------------------------------------------------------------------------
-- Members legitimately update their OWN row: last_read_message_id, mute,
-- read receipts. They must never update `role` or `status` — those are
-- authority decisions made about them, not by them.

drop policy if exists "conversation members update own row" on public.conversation_members;

create policy "conversation members update own row" on public.conversation_members
  for update using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    -- The row's role and status must match what is already stored. Any attempt
    -- to change either through the client is rejected by the policy itself,
    -- regardless of what the application layer does.
    and role = (
      select existing.role from public.conversation_members existing
      where existing.conversation_id = conversation_members.conversation_id
        and existing.user_id = conversation_members.user_id
    )
    and status = (
      select existing.status from public.conversation_members existing
      where existing.conversation_id = conversation_members.conversation_id
        and existing.user_id = conversation_members.user_id
    )
  );

-- ---------------------------------------------------------------------------
-- 2. Exactly one owner per group.
-- ---------------------------------------------------------------------------
-- A partial unique index: at most one JOINED owner per conversation. A
-- transfer that tried to create a second owner fails on this index rather than
-- silently succeeding, which is what makes concurrent transfers safe.
--
-- Scoped to status='joined' so an owner who was removed or left (a state the
-- transfer RPC below never produces, but legacy data might) does not block a
-- legitimate current owner.

create unique index if not exists conversation_members_single_owner_idx
  on public.conversation_members(conversation_id)
  where role = 'owner' and status = 'joined';

-- ---------------------------------------------------------------------------
-- 3. Atomic ownership transfer.
-- ---------------------------------------------------------------------------
-- Two rows change together — the old owner becomes an admin, the new owner
-- becomes owner — and a partial failure would leave the group with no owner or
-- two. A single transactional function is the only safe way to do it.
--
-- Runs as SECURITY DEFINER but authorises against auth.uid(): the caller's own
-- identity decides, never a parameter, so this cannot be used to transfer a
-- group the caller does not own.

create or replace function public.transfer_group_ownership(
  p_conversation_id uuid,
  p_new_owner_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  target_status text;
begin
  if current_user_id is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  -- Lock the CURRENT owner row first. Two concurrent transfers serialise here:
  -- the second waits, then re-reads and finds the caller is no longer owner.
  perform 1
  from public.conversation_members
  where conversation_id = p_conversation_id
    and user_id = current_user_id
    and role = 'owner'
    and status = 'joined'
  for update;

  if not found then
    raise exception 'not_group_owner' using errcode = '42501';
  end if;

  -- The new owner must already be a joined member. Ownership is never granted
  -- to someone outside the group.
  select status into target_status
  from public.conversation_members
  where conversation_id = p_conversation_id
    and user_id = p_new_owner_id
  for update;

  if target_status is distinct from 'joined' then
    raise exception 'target_not_member' using errcode = 'P0002';
  end if;

  if p_new_owner_id = current_user_id then
    raise exception 'already_owner' using errcode = 'P0002';
  end if;

  -- Step down FIRST, so the single-owner index is never violated mid-transfer.
  -- The outgoing owner keeps authority as an admin rather than being demoted
  -- to member: they built the group, and silently stripping them would be a
  -- surprise the product never asked for.
  update public.conversation_members
  set role = 'admin', updated_at = now()
  where conversation_id = p_conversation_id and user_id = current_user_id;

  update public.conversation_members
  set role = 'owner', updated_at = now()
  where conversation_id = p_conversation_id and user_id = p_new_owner_id;
end;
$$;

revoke all on function public.transfer_group_ownership(uuid, uuid) from public;
grant execute on function public.transfer_group_ownership(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Backfill: every existing group must have exactly one owner.
-- ---------------------------------------------------------------------------
-- Existing groups already record their creator twice: `conversations.created_by`
-- and a `conversation_members` row written with role='owner' at creation. So
-- for groups created through the product there is nothing to reconstruct.
--
-- This repairs only the case where an owner row is missing — promoting the
-- recorded creator, and ONLY the recorded creator. No historical admin roles
-- are invented, and no ownership is guessed for a group whose creator is
-- unknown: such a group is reported by the verification query below rather
-- than being handed to an arbitrary member.

update public.conversation_members as member
set role = 'owner', updated_at = now()
from public.conversations as conversation
where conversation.id = member.conversation_id
  and conversation.conversation_type = 'group'
  and conversation.created_by = member.user_id
  and member.status = 'joined'
  and member.role <> 'owner'
  and not exists (
    select 1 from public.conversation_members as existing
    where existing.conversation_id = conversation.id
      and existing.role = 'owner'
      and existing.status = 'joined'
  );

-- Groups that STILL have no owner after the backfill: either created_by is
-- null, or the creator is no longer a joined member. Deliberately NOT repaired
-- automatically — promoting an arbitrary member would be fabricating authority
-- nobody granted. Surfaced as a warning for a human decision.
do $$
declare
  orphan_count integer;
begin
  select count(*) into orphan_count
  from public.conversations as conversation
  where conversation.conversation_type = 'group'
    and conversation.status = 'active'
    and not exists (
      select 1 from public.conversation_members as member
      where member.conversation_id = conversation.id
        and member.role = 'owner'
        and member.status = 'joined'
    );

  if orphan_count > 0 then
    raise warning 'ownerless_groups_require_review: % active group(s) have no joined owner; creator is null or has left. Not auto-assigned.', orphan_count;
  end if;
end;
$$;
