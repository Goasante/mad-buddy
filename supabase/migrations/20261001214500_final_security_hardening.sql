-- Final application hardening: reduce RPC exposure and pin function search paths.
-- Drift-safe: each operation is applied only when that exact function exists.
-- This does not change function bodies or RLS policy semantics.

do $hardening$
declare
  sig text;
begin
  foreach sig in array array[
    'public.accept_friend_request(uuid)',
    'public.buddy_score_total(uuid)',
    'public.can_publish_open_moments(uuid)',
    'public.can_view_safe_arrival_session(uuid,boolean)',
    'public.chat_poll_parent_is_live(uuid)',
    'public.is_conversation_member(uuid)',
    'public.is_event_circle_owner(uuid)',
    'public.is_plan_creator(uuid)',
    'public.is_safe_arrival_traveller(uuid)',
    'public.transfer_group_ownership(uuid,uuid)'
  ]
  loop
    if to_regprocedure(sig) is not null then
      execute format('revoke execute on function %s from anon', sig);
    end if;
  end loop;
end
$hardening$;

do $hardening$
declare
  sig text;
begin
  foreach sig in array array[
    'public.set_updated_at()',
    'public.claim_jobs(text,integer,integer)',
    'public.prevent_audit_mutation()',
    'public.prevent_domain_event_mutation()',
    'public.location_confidence_for_accuracy(double precision)',
    'public.admin_active_plan_mix()',
    'public.admin_daily_signup_counts(timestamp with time zone)',
    'public.get_cancellation_reason_counts(timestamp with time zone)',
    'public.prevent_buddy_score_mutation()',
    'public.conversation_previews(uuid,uuid[])'
  ]
  loop
    if to_regprocedure(sig) is not null then
      execute format('alter function %s set search_path = public, pg_temp', sig);
    end if;
  end loop;
end
$hardening$;
