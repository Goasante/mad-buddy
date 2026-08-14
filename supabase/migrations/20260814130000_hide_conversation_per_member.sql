-- Hiding a chat is a personal act, not a shared one.
--
-- A direct conversation is one row shared by two people. There is no safe way
-- to "delete" it for one of them: removing the row, or tombstoning it with
-- conversations.status, would erase the other person's history because of
-- something you did. So hiding lives on the MEMBERSHIP, where it belongs --
-- one column, scoped to one member, invisible to the other.
--
-- WHAT THIS IS NOT:
--   * Not a delete. No message row is touched, ever.
--   * Not leaving. `status` stays 'joined'; membership, roles and unread
--     semantics are unchanged.
--   * Not a Circle exit. Circles keep Leave Circle, which is a different act
--     with different consequences for other people.
--
-- RESURRECTION, and why it needs a new timestamp rather than an existing one.
-- A hidden chat should come back when the conversation genuinely resumes. The
-- obvious candidate, `conversations.last_message_at`, is ALSO bumped by
-- publishSystemMessage -- so a Circle rename or an admin change would drag a
-- deliberately hidden conversation back into the inbox. That is exactly the
-- confusion migration 20260814120000 removed from unread counts, and it must
-- not be reintroduced here.
--
-- The authority is therefore "the newest message a PERSON sent", computed in
-- the preview RPC below as `last_user_message_at`. A conversation is visible
-- when it was never hidden, or when a human has spoken in it since.
--
-- Additive and reversible:
--   Rollback: alter table public.conversation_members drop column hidden_at;
--             then restore conversation_previews from 20260814120000.

alter table public.conversation_members
  add column if not exists hidden_at timestamptz;

comment on column public.conversation_members.hidden_at is
  'When this member hid the conversation from their own inbox. Null means visible. Affects only this member; the conversation, its messages and every other member are untouched. Cleared implicitly by a newer user message (see conversation_previews.last_user_message_at), never by a system event.';

-- Partial: the overwhelming majority of rows are null, and only the hidden
-- ones are ever filtered on.
create index if not exists conversation_members_hidden_idx
  on public.conversation_members (user_id, hidden_at)
  where hidden_at is not null;

-- ---------------------------------------------------------------------------
-- Preview RPC: expose the newest USER message time.
--
-- Same signature plus one column. The unread predicate from
-- 20260814120000 is carried forward UNCHANGED -- this migration adds a column
-- and changes no existing behaviour.
-- ---------------------------------------------------------------------------

-- DROPPED, not replaced. Postgres refuses `create or replace function` when
-- the OUT parameters change, and this adds a returned column -- so the old
-- definition has to go first. Same name and argument types, so every caller
-- and the grants below are restored identically a few lines later.
drop function if exists public.conversation_previews(uuid, uuid[]);

create function public.conversation_previews(
  p_user_id uuid,
  p_conversation_ids uuid[]
)
returns table (
  conversation_id uuid,
  last_text text,
  last_message_type text,
  last_created_at timestamptz,
  unread_count integer,
  -- NEW: newest non-system message, or null when only system events exist.
  -- This is the authority for un-hiding, deliberately distinct from
  -- conversations.last_message_at which system events also advance.
  last_user_message_at timestamptz
)
language sql
stable
as $$
  with target as (
    select id from unnest(p_conversation_ids) as id
  ),
  read_marks as (
    select cm.conversation_id, rm.created_at as read_at
    from public.conversation_members cm
    left join public.messages rm on rm.id = cm.last_read_message_id
    where cm.user_id = p_user_id and cm.conversation_id = any(p_conversation_ids)
  )
  select
    t.id as conversation_id,
    lm.text_content as last_text,
    lm.message_type as last_message_type,
    lm.created_at as last_created_at,
    coalesce(uc.unread_count, 0)::integer as unread_count,
    um.last_user_message_at
  from target t
  left join lateral (
    -- Unchanged: the preview still shows whatever happened last, including a
    -- system event.
    select m.text_content, m.message_type, m.created_at
    from public.messages m
    where m.conversation_id = t.id and m.deleted_at is null
    order by m.created_at desc
    limit 1
  ) lm on true
  left join lateral (
    -- Only messages a person sent. A system event must never resurrect a
    -- conversation somebody chose to hide.
    select max(m3.created_at) as last_user_message_at
    from public.messages m3
    where m3.conversation_id = t.id
      and m3.message_type <> 'system'
      and m3.deleted_at is null
  ) um on true
  left join read_marks r on r.conversation_id = t.id
  left join lateral (
    select count(*)::integer as unread_count
    from public.messages m2
    where m2.conversation_id = t.id
      and m2.sender_id is distinct from p_user_id
      -- Carried forward from 20260814120000, unchanged.
      and m2.message_type <> 'system'
      and m2.deleted_at is null
      and m2.created_at > coalesce(r.read_at, 'epoch'::timestamptz)
  ) uc on true;
$$;

revoke all on function public.conversation_previews(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.conversation_previews(uuid, uuid[]) to service_role;
