-- BETA-001 — a re-made friendship must reopen the pair's direct conversation.
--
-- TESTER EVIDENCE (production). Block, unblock, re-add, and the thread still
-- says "This conversation is closed." Every send fails with Not sent / Retry /
-- Delete, permanently.
--
-- ROOT CAUSE. `blockUserAction` archives the pair's direct conversation
-- (`applyBlockToConversations`, messaging/service.ts). Nothing ever un-archives
-- it: `unblockUserAction` only deletes the `blocked_users` row, and the
-- relationship-lifecycle RPC that reactivates a friendship does not touch
-- `conversations` at all. The archive is a ONE-WAY DOOR, and
-- `resolveSendPermission` refuses on `conversationStatus !== 'active'`.
--
-- Reproduced end to end in scripts/hardening/block-unblock-readd.mjs before
-- this migration: 9/10, with the single failure being exactly the reported
-- defect.
--
-- WHY A TRIGGER, AND NOT A FIX IN unblockUserAction.
--
-- Unblocking is the wrong place. Unblock alone must NOT reopen a conversation:
-- at that moment there is no relationship -- blocking ended the friendship, and
-- the two are strangers who happen to share history. Reopening on unblock would
-- let one person restore a channel the other has not agreed to.
--
-- The correct authority is the RELATIONSHIP. A conversation is usable when a
-- live friendship exists, so the reopen belongs on the transition that creates
-- one. Friendships are written from several paths -- the accept-request RPC,
-- the relationship-lifecycle RPC, and any future one -- so application code
-- would have to remember in each. The database is the one place they all pass
-- through.
--
-- THIS IS NOT "HIDE THE BANNER". The banner is a correct projection of
-- `conversations.status`. The defect is that the status was never restored, and
-- that is what this repairs.

create or replace function public.reopen_direct_conversation_on_friendship()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_direct_key text;
begin
  -- Only a LIVE friendship reopens anything.
  if new.ended_at is not null then
    return new;
  end if;

  -- And only the transition INTO live. An UPDATE that leaves an already-live
  -- row untouched should not rewrite conversation state.
  if tg_op = 'UPDATE' and old.ended_at is null then
    return new;
  end if;

  -- A block outranks a friendship. If either side still blocks the other, the
  -- conversation stays closed no matter what the friendship row says -- the
  -- rows could legitimately disagree for a moment, and the safer reading wins.
  if exists (
    select 1 from public.blocked_users b
    where (b.blocker_id = new.user_one_id and b.blocked_id = new.user_two_id)
       or (b.blocker_id = new.user_two_id and b.blocked_id = new.user_one_id)
  ) then
    return new;
  end if;

  -- The canonical direct key: the two ids, sorted, colon-joined. Identical to
  -- `directConversationKey` in the application.
  v_direct_key := least(new.user_one_id::text, new.user_two_id::text)
                  || ':' ||
                  greatest(new.user_one_id::text, new.user_two_id::text);

  /* Reopen ONLY an archived row, and only the direct one.
     - `status = 'archived'` guards against resurrecting a conversation closed
       for some other reason a future feature might introduce.
     - No row is created here. If the pair never had a conversation, they get
       one the normal way, through getOrCreateDirectConversation. */
  update public.conversations
     set status = 'active', updated_at = now()
   where direct_key = v_direct_key
     and conversation_type = 'direct'
     and status = 'archived';

  /* Membership is restored too. A block leaves members joined, but a `left` or
     `removed` row from an earlier exit would silently keep somebody out of a
     conversation the relationship now permits. Only the two people in this
     friendship are touched. */
  update public.conversation_members cm
     set status = 'joined'
    from public.conversations c
   where c.id = cm.conversation_id
     and c.direct_key = v_direct_key
     and c.conversation_type = 'direct'
     and cm.user_id in (new.user_one_id, new.user_two_id)
     and cm.status <> 'joined';

  return new;
end;
$$;

revoke all on function public.reopen_direct_conversation_on_friendship() from public, anon, authenticated;

comment on function public.reopen_direct_conversation_on_friendship() is
  'BETA-001: reopens an archived direct conversation when a friendship becomes live again. Blocks still outrank it. Never creates a conversation, never reopens a non-archived one.';

drop trigger if exists friendships_reopen_direct_conversation on public.friendships;
create trigger friendships_reopen_direct_conversation
  after insert or update of ended_at on public.friendships
  for each row
  execute function public.reopen_direct_conversation_on_friendship();

-- ROLLBACK (for the production application order; not run here):
--   drop trigger if exists friendships_reopen_direct_conversation on public.friendships;
--   drop function if exists public.reopen_direct_conversation_on_friendship();
--
-- Rolling back restores the defect: re-made friendships keep a dead thread.
-- It exposes nothing -- the failure mode is refusing to send, not over-sharing.
