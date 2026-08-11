-- Realtime for friend_requests (Vercel usage optimization pass).
--
-- useIncomingRequestCount polled /api/friends/request-count every 30 seconds
-- on every authenticated page, with no Realtime path at all -- the one badge
-- of the three (messages, notifications, friend requests) that had never had
-- one. That accounted for 259 invocations of a route that, most of the time,
-- returned the same number it returned 30 seconds earlier.
--
-- Authorization is the existing RLS policy ("friend requests visible to
-- participants": auth.uid() in (sender_id, receiver_id)), from
-- 20260709100000_initial_schema.sql — realtime respects RLS for
-- authenticated postgres_changes subscriptions, so a client only ever
-- receives rows where they are the sender or the receiver, same as every
-- other read of this table. Insert/update remain governed by their own RLS
-- policies (sender creates, participants update); this migration grants read
-- visibility over the change stream only, not new write access.
--
-- Rollback: alter publication supabase_realtime drop table public.friend_requests;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'friend_requests'
  ) then
    alter publication supabase_realtime add table public.friend_requests;
  end if;
end
$$;
