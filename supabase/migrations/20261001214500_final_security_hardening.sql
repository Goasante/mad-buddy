-- Final application hardening: reduce RPC exposure and pin function search paths.
-- This migration is intentionally narrow. It does not change function bodies
-- or RLS policy semantics.

-- SECURITY DEFINER helpers are used by authenticated app/RLS flows. Anonymous
-- callers never need direct EXECUTE permission.
revoke execute on function public.accept_friend_request(uuid) from anon;
revoke execute on function public.buddy_score_total(uuid) from anon;
revoke execute on function public.can_publish_open_moments(uuid) from anon;
revoke execute on function public.can_view_safe_arrival_session(uuid, boolean) from anon;
revoke execute on function public.chat_poll_parent_is_live(uuid) from anon;
revoke execute on function public.is_conversation_member(uuid) from anon;
revoke execute on function public.is_event_circle_owner(uuid) from anon;
revoke execute on function public.is_plan_creator(uuid) from anon;
revoke execute on function public.is_safe_arrival_traveller(uuid) from anon;
revoke execute on function public.transfer_group_ownership(uuid, uuid) from anon;

-- Pin search_path for functions reported by the database security advisor.
alter function public.set_updated_at() set search_path = public, pg_temp;
alter function public.claim_jobs(text, integer, integer) set search_path = public, pg_temp;
alter function public.prevent_audit_mutation() set search_path = public, pg_temp;
alter function public.prevent_domain_event_mutation() set search_path = public, pg_temp;
alter function public.location_confidence_for_accuracy(double precision) set search_path = public, pg_temp;
alter function public.admin_active_plan_mix() set search_path = public, pg_temp;
alter function public.admin_daily_signup_counts(timestamp with time zone) set search_path = public, pg_temp;
alter function public.get_cancellation_reason_counts(timestamp with time zone) set search_path = public, pg_temp;
alter function public.prevent_buddy_score_mutation() set search_path = public, pg_temp;
alter function public.conversation_previews(uuid, uuid[]) set search_path = public, pg_temp;
