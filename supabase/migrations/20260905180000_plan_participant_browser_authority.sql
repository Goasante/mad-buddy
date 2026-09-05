-- SEC-002 — plan_participants browser authority hardening.
--
-- Production's hosted Supabase default ACL grants broad table DML to browser
-- roles. On plan_participants that combines with the historical own-row UPDATE
-- policy to let a participant rewrite authority-bearing columns such as role.
-- The canonical Plan lifecycle no longer trusts browser table mutations:
-- RSVP and participant changes go through service-role-only RPCs in
-- 20260814200000_canonical_plan_lifecycle.sql.
--
-- Therefore the correct authority is simpler and stronger than trying to pin
-- individual columns in the old policy: browser roles have no DML on this table
-- at all. The service role keeps its existing grants and remains the canonical
-- mutation authority.

revoke insert, update, delete
  on table public.plan_participants
  from public, anon, authenticated;

-- Defense in depth: this policy represented a browser mutation path that the
-- product no longer uses. Removing it means a future accidental base UPDATE
-- grant still cannot reactivate self-promotion through RLS.
drop policy if exists "participants update own rsvp"
  on public.plan_participants;

-- Intentionally unchanged:
--   * SELECT policies / grants — read authority is audited separately.
--   * service_role privileges — canonical Plan RPCs require them.
--   * Plan lifecycle functions — no business-logic change in SEC-002.
