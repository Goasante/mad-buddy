-- ---------------------------------------------------------------------------
-- A tombstoned poll must stop being readable.
--
-- chat_polls was designed around a hard delete: "The poll id IS the message id.
-- This keeps one canonical timeline item and makes delete-for-everyone cascade
-- the structured payload automatically" (20260828191000). That cascade was the
-- whole revocation story for polls.
--
-- Delete-for-everyone no longer hard-deletes. It sets deleted_at and nulls
-- text_content, so the row survives on purpose -- and `on delete cascade` never
-- fires. The poll question, its option labels and its votes therefore outlived
-- the message they belonged to, and every poll policy authorized on
-- conversation membership ALONE:
--
--   using (public.is_conversation_member(conversation_id))
--
-- so any member could still read a deleted poll's contents directly, no server
-- action involved.
--
-- The rule is that a poll is readable only while its parent message is alive.
-- Retention is unchanged: the child rows stay stored, exactly as the tombstone
-- architecture intends. What stops is SERVING them.
-- ---------------------------------------------------------------------------

-- One definition of "this poll's parent message is still alive", so the four
-- policies below cannot drift apart. security definer for the same reason
-- is_conversation_member is: the policy must not depend on the caller's own
-- read access to messages.
create or replace function public.chat_poll_parent_is_live(p_message_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.messages m
    where m.id = p_message_id
      and m.deleted_at is null
      and m.status <> 'deleted'
  );
$$;

comment on function public.chat_poll_parent_is_live(uuid) is
  'True when a poll''s canonical parent message exists and is not tombstoned. Delete-for-everyone keeps the messages row (deleted_at set, text nulled), so the FK cascade that used to revoke poll payload no longer fires; poll read policies call this instead. See 20260904160000.';

-- service_role is the server's identity and must keep working after any
-- function is (re)created -- a fresh database otherwise 42501s app-wide.
grant execute on function public.chat_poll_parent_is_live(uuid) to service_role, authenticated;

-- ---------------------------------------------------------------------------
-- Poll payload: membership AND a live parent.
-- ---------------------------------------------------------------------------

drop policy if exists "chat polls visible to members" on public.chat_polls;
create policy "chat polls visible to members" on public.chat_polls
  for select using (
    public.is_conversation_member(conversation_id)
    and public.chat_poll_parent_is_live(message_id)
  );

drop policy if exists "chat poll options visible to members" on public.chat_poll_options;
create policy "chat poll options visible to members" on public.chat_poll_options
  for select using (
    exists (
      select 1 from public.chat_polls p
      where p.message_id = chat_poll_options.poll_message_id
        and public.is_conversation_member(p.conversation_id)
        and public.chat_poll_parent_is_live(p.message_id)
    )
  );

drop policy if exists "chat poll votes visible to members" on public.chat_poll_votes;
create policy "chat poll votes visible to members" on public.chat_poll_votes
  for select using (
    exists (
      select 1 from public.chat_polls p
      where p.message_id = chat_poll_votes.poll_message_id
        and public.is_conversation_member(p.conversation_id)
        and public.chat_poll_parent_is_live(p.message_id)
    )
  );

-- Voting on a deleted poll must fail even with a forged, known poll id.
drop policy if exists "chat poll votes owner insert" on public.chat_poll_votes;
create policy "chat poll votes owner insert" on public.chat_poll_votes
  for insert with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.chat_polls p
      where p.message_id = chat_poll_votes.poll_message_id
        and p.closed_at is null
        and public.is_conversation_member(p.conversation_id)
        and public.chat_poll_parent_is_live(p.message_id)
    )
  );

-- "chat poll votes owner delete" is deliberately unchanged: withdrawing your
-- own vote is not a read of deleted content, and blocking it would strand a
-- vote a person is entitled to remove.
