-- FRESH-DATABASE REPRODUCIBILITY: browser-role base privileges.
--
-- WHAT WENT WRONG. The PR #19 one-user smoke gate found /api/notifications
-- returning HTTP 500 on a freshly rebuilt staging database. Isolated:
--
--   notifications as authenticated -> 403 42501 permission denied
--   notifications as service_role  -> 200
--
-- The database has 271 RLS policies but `authenticated` held SELECT on only
-- 4 of 191 public tables. RLS NARROWS access that a base GRANT must first
-- provide: a policy on a table the role cannot read is inert, and the request
-- fails before any policy is consulted.
--
-- This is the same defect class as
-- 20260903120000_service_role_grant_reproducibility.sql, which repaired
-- service_role. That repair was deliberately scoped to the trusted backend
-- role; this one completes the picture for the browser roles.
--
-- WHY PRODUCTION IS UNAFFECTED. Production predates this and carries platform
-- default-privilege state granting DML on newly created tables. As before, the
-- schema was reproducible and the ACLs were not.
--
-- HOW THIS LIST WAS DERIVED. NOT by mirroring pg_policies -- that would be
-- mechanical and wrong for a privacy-sensitive app. scripts/audit-browser-acl.mjs
-- applies a deliberate evidence precedence:
--
--   A. An explicit REVOKE in migration history WINS, always. Security
--      hardening is never undone by inference.
--   B. An explicit GRANT is authoritative.
--   C. An RLS policy is REQUIRED evidence but NOT SUFFICIENT -- a policy can
--      outlive its client path, and server-only tables carry historical ones.
--   D. The application must actually reach the table over a browser-role
--      transport (user-scoped client, Bearer, or Realtime), not only through
--      the service-role admin client or a security-definer RPC.
--
-- The result is 39 statements across 39 of 191 tables -- not a blanket grant.
-- Verified: no statement below contradicts any explicit REVOKE in history.
--
-- notifications is the worked example. History says owner-read via RLS while
-- insert/update/delete stay revoked (20260719160000), so this grants SELECT
-- and nothing else. Client-side notification mutation stays closed.
--
-- ANON RECEIVES NOTHING. A generic `auth.uid()` policy technically applies to
-- PUBLIC, but it was written for signed-in callers; treating that as evidence
-- for anon would hand signed-out visitors read access across the app. anon
-- keeps exactly the authority it already had.
--
-- NO DEFAULT PRIVILEGES FOR BROWSER ROLES. Deliberate. The service-role repair
-- uses ALTER DEFAULT PRIVILEGES so future tables work; doing that for anon or
-- authenticated would silently grant access to every future table before its
-- security contract has been reviewed. Every new browser-readable table must
-- add its grant explicitly, and lib/security/browser-role-grants.test.ts fails
-- the build when an RLS policy intended for browser use has no base grant.
--
-- IDEMPOTENT. GRANT is declarative; re-running changes nothing. Safe on a
-- database that already has these privileges, including production.

grant usage on schema public to anon, authenticated;

grant insert on public.app_feedback to authenticated;
grant select, insert, update on public.best_buddies to authenticated;
grant select, insert, update, delete on public.blocked_users to authenticated;
grant select on public.chat_poll_options to authenticated;
grant select, insert, delete on public.chat_poll_votes to authenticated;
grant select on public.chat_polls to authenticated;
grant insert on public.circle_members to authenticated;
grant select on public.conversation_chat_settings to authenticated;
grant select on public.conversation_members to authenticated;
grant select on public.conversation_message_pins to authenticated;
grant select, insert, update on public.conversation_presence to authenticated;
grant select on public.conversation_user_preferences to authenticated;
grant insert on public.event_modes to authenticated;
grant select on public.feature_flags to authenticated;
grant select, insert on public.friend_circles to authenticated;
grant select on public.friend_requests to authenticated;
grant select on public.friendships to authenticated;
grant select on public.media_assets to authenticated;
grant select on public.meetup_requests to authenticated;
grant select on public.message_contacts to authenticated;
grant select on public.message_event_refs to authenticated;
grant select on public.message_places to authenticated;
grant select, insert, update on public.messages to authenticated;
grant select on public.notifications to authenticated;
grant insert on public.privacy_zones to authenticated;
grant select on public.profiles to authenticated;
grant insert, update, delete on public.push_subscriptions to authenticated;
grant select, insert on public.reports to authenticated;
grant select on public.safe_arrival_contacts to authenticated;
grant select on public.safe_arrival_sessions to authenticated;
grant select, insert on public.saved_message_folders to authenticated;
grant select, insert, update, delete on public.saved_messages to authenticated;
grant select on public.subscriptions to authenticated;
grant select on public.support_requests to authenticated;
grant insert on public.support_tickets to authenticated;
grant select on public.user_locations to authenticated;
grant select, insert, update on public.user_preferences to authenticated;
grant select on public.user_statuses to authenticated;
grant select on public.wallpapers to authenticated;

-- ROLLBACK (not run here): revoke each grant above. Rolling back restores the
-- defect -- a fresh database returns 42501 on every RLS-scoped browser read
-- while production, which has the platform grants, keeps working.
