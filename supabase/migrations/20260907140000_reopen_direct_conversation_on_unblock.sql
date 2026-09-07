-- BETA-001 COMPLETION: reopen the direct conversation when the LAST block goes.
--
-- 20260824140000 restored a conversation when a friendship became live again,
-- and deliberately refused to do so while a block was still standing -- a block
-- outranks a friendship, which is correct and is kept exactly as it is.
--
-- What was missing is the mirror. The reopen only ever fired on `friendships`,
-- so it depended on the friendship being the LAST of the two events. A real
-- user can just as easily re-friend first and unblock second:
--
--     block  ->  re-friend (trigger fires, sees the live block, correctly
--                declines)  ->  unblock (nothing fires at all)
--
-- and the pair is left as Muddies, with nobody blocked, and a conversation
-- still `archived` -- so every send is refused by `resolveCanSendMessage`
-- ("conversation_closed") and the sender sees "Not sent". Reproduced locally
-- against the real schema before this migration was written.
--
-- This adds the missing half: the same restoration, keyed on the block being
-- removed. Whichever of the two events happens last now performs the reopen,
-- so the pair's state is order-independent.
--
-- IT DOES NOT WIDEN ANYTHING. There must still be a live friendship, there
-- must be no remaining block in EITHER direction, only an `archived` direct
-- conversation is touched, and no conversation is ever created here.

create or replace function public.reopen_direct_conversation_on_unblock()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_direct_key text;
begin
  -- The OTHER direction may still block. A block outranks a friendship, so one
  -- side lifting theirs while the other stands changes nothing.
  if exists (
    select 1 from public.blocked_users b
    where (b.blocker_id = old.blocker_id and b.blocked_id = old.blocked_id)
       or (b.blocker_id = old.blocked_id and b.blocked_id = old.blocker_id)
  ) then
    return old;
  end if;

  -- Unblocking ALONE never restores anything. Access comes from the
  -- relationship; this only re-opens what a live friendship already permits.
  if not exists (
    select 1 from public.friendships f
    where f.ended_at is null
      and f.user_one_id = least(old.blocker_id, old.blocked_id)
      and f.user_two_id = greatest(old.blocker_id, old.blocked_id)
  ) then
    return old;
  end if;

  -- Identical to `directConversationKey` in the application.
  v_direct_key := least(old.blocker_id::text, old.blocked_id::text)
                  || ':' ||
                  greatest(old.blocker_id::text, old.blocked_id::text);

  update public.conversations
     set status = 'active', updated_at = now()
   where direct_key = v_direct_key
     and conversation_type = 'direct'
     and status = 'archived';

  update public.conversation_members cm
     set status = 'joined'
    from public.conversations c
   where c.id = cm.conversation_id
     and c.direct_key = v_direct_key
     and c.conversation_type = 'direct'
     and cm.user_id in (old.blocker_id, old.blocked_id)
     and cm.status <> 'joined';

  return old;
end;
$$;

-- Trigger functions are invoked by the trigger, never called directly, so no
-- role needs EXECUTE. `service_role` is revoked too, matching the BETA-001
-- function this one mirrors -- a global default-privileges rule would
-- otherwise grant it here and leave the pair inconsistent.
revoke all on function public.reopen_direct_conversation_on_unblock() from public, anon, authenticated, service_role;

comment on function public.reopen_direct_conversation_on_unblock() is
  'BETA-001 completion: reopens an archived direct conversation when the last block between an already-live pair is lifted. Requires a live friendship and no remaining block in either direction. Never creates a conversation.';

drop trigger if exists blocked_users_reopen_direct_conversation on public.blocked_users;
create trigger blocked_users_reopen_direct_conversation
  after delete on public.blocked_users
  for each row
  execute function public.reopen_direct_conversation_on_unblock();

-- ROLLBACK:
--   drop trigger if exists blocked_users_reopen_direct_conversation on public.blocked_users;
--   drop function if exists public.reopen_direct_conversation_on_unblock();
