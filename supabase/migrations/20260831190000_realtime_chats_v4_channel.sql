-- Realtime for the V4 Chats channel.
--
-- THE DEFECT. `chats-v4:<conversationId>` subscribes to five tables:
--   messages, conversation_presence, conversation_message_pins,
--   chat_polls, chat_poll_votes
-- but only `messages` was ever added to the supabase_realtime publication.
-- Supabase Realtime refuses the WHOLE channel when any requested table is not
-- published, so the subscription never opened and NOTHING arrived live: a new
-- message, a presence change, a pin, or a poll vote only appeared after a
-- reload. The socket connected and stayed open, which is why this looked like
-- a working realtime setup rather than a dead one.
--
-- Proven on an isolated local stack: with only `messages` published, a second
-- persona's message did not arrive within 25s (it appeared after reload); with
-- all five published, it arrived in ~4s with no reload.
--
-- Authorization is unchanged. Realtime respects RLS for authenticated
-- postgres_changes subscriptions, so a client still only receives rows the
-- existing policies already let it read, and the client-side filter is scoped
-- to one conversation id. This grants realtime read visibility only; no
-- insert/update/delete privilege is granted to anon or authenticated here.
--
-- Rollback:
--   alter publication supabase_realtime drop table public.conversation_presence;
--   alter publication supabase_realtime drop table public.conversation_message_pins;
--   alter publication supabase_realtime drop table public.chat_polls;
--   alter publication supabase_realtime drop table public.chat_poll_votes;

do $$
declare
  target text;
begin
  foreach target in array array[
    'conversation_presence',
    'conversation_message_pins',
    'chat_polls',
    'chat_poll_votes'
  ] loop
    if to_regclass('public.' || target) is not null
      and not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = target
      )
    then
      execute format('alter publication supabase_realtime add table public.%I', target);
    end if;
  end loop;
end
$$;
