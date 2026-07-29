-- N+1 fix: listConversations() previously issued up to 4 sequential queries
-- PER conversation (other-user/group-name lookup, last message, unread
-- count, and a nested read-timestamp lookup) to render the Messages list.
-- This RPC returns the last message + unread count for a whole batch of
-- conversations in one round trip; the remaining per-conversation data
-- (other-user profile, group name) is batched separately in application
-- code via .in(). Additive only, no existing table/policy touched.

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
      and m2.deleted_at is null
      and m2.created_at > coalesce(r.read_at, 'epoch'::timestamptz)
  ) uc on true;
$$;

-- Only ever invoked server-side via the service-role client (which already
-- bypasses RLS), so this stays a plain (invoker-rights) function rather than
-- security definer — no privilege escalation beyond what the caller already
-- has.
revoke all on function public.conversation_previews(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.conversation_previews(uuid, uuid[]) to service_role;
