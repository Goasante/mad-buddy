-- Unread counts human messages, not administrative facts.
--
-- THE DEFECT. `conversation_previews` filtered its unread subquery on sender,
-- deletion and read mark, but never on `message_type`. Every Circle system
-- event -- "Ama became an admin", "Kojo was removed", a rename -- is a row in
-- `public.messages` with `message_type = 'system'`, so each one counted as an
-- unread message for every member.
--
-- Worse, `publishSystemMessage` inserts these rows with `sender_id = null`,
-- and in SQL `null is distinct from <uuid>` is TRUE. So the existing
-- "not my own message" guard did not exclude them either: the person who
-- performed the action was shown unread mail about their own administrative
-- change, in a conversation they had never opened.
--
-- Measured before this change: one Circle holding a `member_promoted` event
-- produced a Messages badge of 1 for an account with zero unread messages,
-- and four of ten accounts with memberships had inflated counts.
--
-- THE RULE THIS ESTABLISHES:
--   Unread = unread USER messages in JOINED conversations,
--            excluding the viewer's own messages and system messages.
--
-- Membership ("joined") is enforced by the callers, which select the
-- conversation ids they pass in; this function is only responsible for the
-- message-level half of that sentence.
--
-- WHAT IS DELIBERATELY NOT CHANGED:
--   * Timeline visibility -- system events still appear in the conversation.
--   * Inbox preview -- `last_text` / `last_message_type` still consider system
--     rows, so a Circle whose newest activity is a rename still previews it.
--   * Ordering -- `conversations.last_message_at` is written elsewhere and is
--     untouched, so a system event still lifts the Circle.
--   * Push -- `publishSystemMessage` never notified anyone, and still does not.
--   * No data rows are read, written or repaired. The invited/system rows in
--     production are valid state; only the arithmetic over them changes.
--
-- Additive and idempotent: `create or replace` on one function, same
-- signature, same return shape, same grants. No table, policy, index or
-- trigger is touched.
--
-- Rollback: re-run the previous definition from
-- 20260728160000_conversation_previews_rpc.sql (delete the single
-- `message_type` predicate added below).

create or replace function public.conversation_previews(
  p_user_id uuid,
  p_conversation_ids uuid[]
)
returns table (
  conversation_id uuid,
  last_text text,
  last_message_type text,
  last_created_at timestamptz,
  unread_count integer
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
    coalesce(uc.unread_count, 0)::integer as unread_count
  from target t
  left join lateral (
    -- UNCHANGED: the preview still shows whatever happened last, including a
    -- system event. "Ama became an admin" is a legitimate thing for a Circle
    -- row to say; it simply is not unread mail.
    select m.text_content, m.message_type, m.created_at
    from public.messages m
    where m.conversation_id = t.id and m.deleted_at is null
    order by m.created_at desc
    limit 1
  ) lm on true
  left join read_marks r on r.conversation_id = t.id
  left join lateral (
    select count(*)::integer as unread_count
    from public.messages m2
    where m2.conversation_id = t.id
      and m2.sender_id is distinct from p_user_id
      -- THE FIX. A system event is server-generated bookkeeping, not something
      -- a person sent to anyone, so it cannot be unread mail. Every other read
      -- of these rows in the application already treats them as non-user
      -- content (no edit, no delete, no contextual actions); this is the one
      -- place that did not.
      and m2.message_type <> 'system'
      and m2.deleted_at is null
      and m2.created_at > coalesce(r.read_at, 'epoch'::timestamptz)
  ) uc on true;
$$;

-- Re-asserted rather than assumed: `create or replace` preserves existing
-- grants, but stating them keeps this migration self-contained if the function
-- is ever recreated from scratch.
revoke all on function public.conversation_previews(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.conversation_previews(uuid, uuid[]) to service_role;
