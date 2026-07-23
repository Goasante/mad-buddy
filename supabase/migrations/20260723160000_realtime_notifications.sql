-- Realtime for notifications, so an incoming Wave can animate on whatever page
-- the recipient is already on instead of waiting for the 60s unread poll.
--
-- Authorization is the existing RLS policy ("notifications owner reads":
-- auth.uid() = user_id) — realtime respects RLS for authenticated
-- postgres_changes subscriptions, so a client only ever receives its own rows.
-- Insert/update/delete remain revoked from anon/authenticated, so this grants
-- read visibility only.
--
-- Rollback: alter publication supabase_realtime drop table public.notifications;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end
$$;
