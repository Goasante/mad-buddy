-- Contact discovery authority hardening.
--
-- Phone identity writes already go through server actions backed by the
-- service-role client, where Mad Buddy applies number normalisation, HMAC
-- derivation, duplicate-claim checks and rate limits. Browser writes therefore
-- add no legitimate capability; they only provide a path around those rules.
--
-- Keep owner SELECT so a signed-in person can inspect their own row if needed,
-- but make every mutation server-authoritative. The service role is retained
-- explicitly for phone save/change/remove and discovery-toggle actions.

drop policy if exists "phone identity owner writes"
  on public.user_phone_identities;

revoke insert, update, delete
  on table public.user_phone_identities
  from anon, authenticated;

grant select
  on table public.user_phone_identities
  to authenticated;

grant all
  on table public.user_phone_identities
  to service_role;

comment on table public.user_phone_identities is
  'Optional phone identity for contact discovery. Owner-readable but server-write-only: application mutations run under service_role so clients cannot bypass normalisation, matching-identifier derivation, duplicate checks or rate limits.';
