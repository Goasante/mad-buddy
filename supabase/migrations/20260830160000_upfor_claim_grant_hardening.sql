-- Restrict claim_upfor_announcement to the worker, by role name.
--
-- FOLLOW-UP, NOT AN EDIT. 20260830120000_upfor_scheduling has already been
-- applied to production, so it is history and stays untouched. This records the
-- correction as its own migration, which is also what makes a rebuild from the
-- repository reproduce the intended posture.
--
-- WHAT WENT WRONG. That migration ended with:
--
--     revoke all on function public.claim_upfor_announcement(...) from public;
--     grant execute on function public.claim_upfor_announcement(...) to service_role;
--
-- which is correct on a database with default privileges. Production carries
-- ALTER DEFAULT PRIVILEGES granting EXECUTE on every newly created function to
-- anon and authenticated. Those are role-specific grants applied at creation
-- time, and revoking from PUBLIC does not remove them -- verified on the linked
-- project, where both roles still held EXECUTE immediately after the migration
-- ran, contradicting the reviewed design of a worker-only claim.
--
-- IMPACT WAS BOUNDED, and worth stating plainly rather than overselling the
-- fix. The function takes no owner argument and only touches a session that is
-- already `active` and has already started, so the worst a caller could do was
-- mark one announcement as claimed and suppress it. No read of anyone's data,
-- no write to another person's rows, no way past the concurrency ceiling.
--
-- Already applied by hand to the linked project when it was found; this makes
-- that permanent and reproducible.
revoke execute on function public.claim_upfor_announcement(uuid, boolean)
  from anon, authenticated;

-- Re-asserted so the intent is legible in one place rather than inferred from
-- an absence. Granting again is harmless if it is already held.
grant execute on function public.claim_upfor_announcement(uuid, boolean)
  to service_role;
