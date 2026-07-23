-- Realtime for the Safe Arrival live-journey animation.
--
-- Adds the session and contact tables to the realtime publication so an open
-- Safe Arrival view updates live: the traveller sees a watcher accept, and a
-- watcher sees the traveller arrive/cancel — without a reload.
--
-- Authorization is the EXISTING RLS: "safe arrival traveller full access" +
-- "safe arrival visible to contacts" on sessions, and the contact-visibility
-- policy on contacts. Realtime honours RLS for authenticated postgres_changes
-- subscriptions, so a blocked or unauthorised user receives nothing. Writes
-- stay server-side (service role) via the existing actions; this grants read
-- visibility only, and the streamed payload is never trusted — the client
-- refetches canonical state on any event.
--
-- Rollback:
--   alter publication supabase_realtime drop table public.safe_arrival_sessions;
--   alter publication supabase_realtime drop table public.safe_arrival_contacts;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'safe_arrival_sessions'
  ) then
    alter publication supabase_realtime add table public.safe_arrival_sessions;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'safe_arrival_contacts'
  ) then
    alter publication supabase_realtime add table public.safe_arrival_contacts;
  end if;
end
$$;
