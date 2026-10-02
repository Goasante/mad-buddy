-- Conference Realtime signals.
-- Realtime never receives Conference content or location. It only carries a
-- generic invalidation signal; clients then re-read through the authorized
-- Conference server loaders, which remain the privacy boundary.

drop policy if exists "conference authenticated receive broadcasts" on realtime.messages;
create policy "conference authenticated receive broadcasts"
on realtime.messages
for select
to authenticated
using (
  realtime.messages.extension = 'broadcast'
  and (
    (select realtime.topic()) = 'conference:feed'
    or (select realtime.topic()) ~ '^conference:topic:[0-9a-f-]{36}$'
  )
);

create or replace function public.conference_emit_topic_signal()
returns trigger
language plpgsql
security definer
set search_path = public, realtime, pg_temp
as $$
declare
  target_id uuid;
begin
  target_id := coalesce(new.id, old.id);

  perform realtime.send(
    '{"kind":"changed"}'::jsonb,
    'changed',
    'conference:feed',
    true
  );

  if target_id is not null then
    perform realtime.send(
      '{"kind":"changed"}'::jsonb,
      'changed',
      'conference:topic:' || target_id::text,
      true
    );
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists conference_topic_realtime_signal on public.conference_topics;
create trigger conference_topic_realtime_signal
after insert or update or delete
on public.conference_topics
for each row
execute function public.conference_emit_topic_signal();

create or replace function public.conference_emit_reply_signal()
returns trigger
language plpgsql
security definer
set search_path = public, realtime, pg_temp
as $$
declare
  target_topic_id uuid;
begin
  target_topic_id := coalesce(new.topic_id, old.topic_id);

  if target_topic_id is not null then
    perform realtime.send(
      '{"kind":"changed"}'::jsonb,
      'changed',
      'conference:topic:' || target_topic_id::text,
      true
    );
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists conference_reply_realtime_signal on public.conference_replies;
create trigger conference_reply_realtime_signal
after insert or update or delete
on public.conference_replies
for each row
execute function public.conference_emit_reply_signal();

revoke all on function public.conference_emit_topic_signal() from public, anon, authenticated;
revoke all on function public.conference_emit_reply_signal() from public, anon, authenticated;
