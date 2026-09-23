-- Contact discovery authority hardening.
--
-- Phone identity writes already go through server actions backed by the
-- service-role client, where Mad Buddy applies number normalisation, HMAC
-- derivation, duplicate-claim checks and rate limits. Browser writes therefore
-- add no legitimate capability; they only provide a path around those rules.
--
-- The product already reads the owner's masked identity through a server
-- action, so the browser needs no direct table privilege at all. Keeping the
-- raw-number table service-role-only also prevents future client code from
-- accidentally turning an implementation detail into a public API.

drop policy if exists "phone identity owner writes"
  on public.user_phone_identities;

drop policy if exists "phone identity owner reads"
  on public.user_phone_identities;

revoke all
  on table public.user_phone_identities
  from public, anon, authenticated;

grant all
  on table public.user_phone_identities
  to service_role;

comment on table public.user_phone_identities is
  'Optional phone identity for contact discovery. Server-only table: owner-facing masked state is returned through authenticated server actions, while raw numbers and matching identifiers remain inaccessible to browser roles.';
