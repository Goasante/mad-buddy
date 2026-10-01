-- Final application hardening.
--
-- Goals:
-- 1) restore intended RPC exposure after later CREATE OR REPLACE drift,
-- 2) keep anon-executable RLS helpers callable only where the policy shape
--    requires it, while making direct anonymous probes return false,
-- 3) pin search_path on mutable-path functions,
-- 4) remove duplicate indexes that only add write overhead.
--
-- This migration is intentionally explicit. Do not mass-revoke every
-- SECURITY DEFINER helper: several RLS policies deliberately execute helpers
-- as anon so signed-out reads fail closed with an empty result instead of 500.

-- ---------------------------------------------------------------------------
-- RPC authority drift: these functions are NOT intended for anon callers.
-- Revoke PUBLIC as well as anon, because PUBLIC execution otherwise makes
-- has_function_privilege('anon', ...) true even after an anon-only revoke.
-- ---------------------------------------------------------------------------

do $hardening$
begin
  if to_regprocedure('public.accept_friend_request(uuid)') is not null then
    revoke execute on function public.accept_friend_request(uuid) from public, anon;
    grant execute on function public.accept_friend_request(uuid) to authenticated;
  end if;

  if to_regprocedure('public.buddy_score_total(uuid)') is not null then
    revoke execute on function public.buddy_score_total(uuid) from public, anon;
    grant execute on function public.buddy_score_total(uuid) to authenticated, service_role;
  end if;

  if to_regprocedure('public.can_publish_open_moments(uuid)') is not null then
    revoke execute on function public.can_publish_open_moments(uuid) from public, anon;
    grant execute on function public.can_publish_open_moments(uuid) to authenticated;
  end if;

  if to_regprocedure('public.transfer_group_ownership(uuid,uuid)') is not null then
    revoke execute on function public.transfer_group_ownership(uuid, uuid) from public, anon;
    grant execute on function public.transfer_group_ownership(uuid, uuid) to authenticated;
  end if;
end
$hardening$;

-- ---------------------------------------------------------------------------
-- chat_poll_parent_is_live must remain executable by anon because anon can
-- reach RLS policies that call it. A direct anonymous RPC call, however, must
-- never reveal whether an arbitrary message UUID exists. Bind the helper to
-- an authenticated session while preserving the fail-closed RLS shape.
-- ---------------------------------------------------------------------------

create or replace function public.chat_poll_parent_is_live(p_message_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null
    and exists (
      select 1
      from public.messages m
      where m.id = p_message_id
        and m.deleted_at is null
        and m.status <> 'deleted'
    );
$$;

revoke all on function public.chat_poll_parent_is_live(uuid) from public;
grant execute on function public.chat_poll_parent_is_live(uuid)
  to anon, authenticated, service_role;

-- The following helpers intentionally remain anon-executable because they are
-- called from policies on anon-readable tables and all derive identity from
-- auth.uid(), which is NULL for signed-out callers:
--   can_view_safe_arrival_session
--   is_conversation_member
--   is_safe_arrival_traveller
--   is_plan_creator
--   is_event_circle_owner

-- ---------------------------------------------------------------------------
-- Search-path hardening. These function bodies either fully qualify their
-- relations or rely only on public/pg_catalog objects.
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- Defense-in-depth ACL cleanup for server/admin tables that already have RLS
-- enabled with no browser policies. Direct browser access already returns no
-- rows; removing the grants reduces exposed surface and makes intent explicit.
-- ---------------------------------------------------------------------------

revoke all on table
  public.access_launch,
  public.account_trust_events,
  public.admin_assignments,
  public.admin_audit_events,
  public.admin_role_permissions,
  public.admin_roles,
  public.admin_users,
  public.analytics_daily_user_facts,
  public.billing_events,
  public.birthday_notification_deliveries,
  public.case_actions,
  public.case_evidence,
  public.domain_events,
  public.feature_flag_rules,
  public.idempotency_keys,
  public.incident_actions,
  public.jobs,
  public.media_deletion_queue,
  public.moderation_actions,
  public.paystack_webhook_events,
  public.promotion_codes,
  public.security_incidents,
  public.sensitive_access_log,
  public.tier_entitlement_overrides,
  public.trust_safety_cases
from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Duplicate indexes identified by the Supabase advisor. Keep one equivalent
-- index (and every constraint-backed index) while removing redundant copies.
-- ---------------------------------------------------------------------------

drop index if exists public.friendships_user_one_id_idx;
drop index if exists public.friendships_user_two_id_idx;
drop index if exists public.muddy_drops_expiry_idx;
drop index if exists public.profiles_user_id_idx;
drop index if exists public.profiles_username_unique_idx;
drop index if exists public.subscriptions_stripe_subscription_id_idx;
drop index if exists public.subscriptions_user_id_idx;
drop index if exists public.user_locations_user_unique_idx;
