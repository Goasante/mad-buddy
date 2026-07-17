-- Realtime for chat (batch 7 spec §64).
--
-- Adds messages to the realtime publication so a joined member's client can
-- subscribe to INSERT/UPDATE events instead of polling. Authorization is the
-- existing RLS policy ("messages visible to members") — realtime respects
-- RLS for authenticated postgres_changes subscriptions, so a non-member
-- receives nothing.
--
-- Rollback: alter publication supabase_realtime drop table public.messages;

alter publication supabase_realtime add table public.messages;
