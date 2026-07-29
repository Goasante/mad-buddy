-- Guided product tours, phase 2: admin governance fields + analytics
-- aggregation. Additive; phase 1 tables/policies/data are not replaced.
--
--  * 'paused' joins the status vocabulary. Pausing must not be modelled as
--    unpublishing, because published_at is what the new-vs-existing cohort
--    split is derived from — clearing it would silently reclassify every user.
--  * Publishing is a governed action, so a version records WHO last changed it
--    and WHY. The full trail still lives in admin_audit_events; these columns
--    exist so the list view can show it without joining the audit log.
--  * Analytics is one server-side aggregate (admin_tour_analytics) over the
--    existing domain_events store. No second event store, and no per-page-view
--    scan of raw history.

alter table public.tour_versions
  drop constraint if exists tour_versions_status_check;

alter table public.tour_versions
  add constraint tour_versions_status_check
  check (status in ('draft', 'published', 'paused', 'retired'));

-- A paused version keeps published_at (see header), so the phase-1 invariant
-- "published implies published_at" is widened rather than broken.
alter table public.tour_versions
  drop constraint if exists tour_version_published_has_timestamp;

alter table public.tour_versions
  add constraint tour_version_published_has_timestamp
  check (status not in ('published', 'paused') or published_at is not null);

alter table public.tour_versions
  add column if not exists updated_by uuid references auth.users(id) on delete set null;

alter table public.tour_versions
  add column if not exists publish_reason text
  check (publish_reason is null or char_length(trim(publish_reason)) between 3 and 280);

-- Consumers must never receive a paused or retired version. The phase-1 policy
-- already restricts reads to status = 'published', so pausing takes effect for
-- consumers immediately with no policy change needed. Re-asserted here so the
-- intent is explicit next to the new status.
comment on column public.tour_versions.status is
  'draft | published | paused | retired. Only ''published'' is readable by consumers (see RLS). Scheduled is derived from published + starts_at, not stored.';

/**
 * Tour funnel + per-step drop-off for one version, aggregated in Postgres.
 *
 * Reads the existing domain_events store written by record_product_event.
 * Tour-level events carry resource_type 'tour_version'; step-level events carry
 * 'tour_step'. Returned as one row per (scope, key, event_name, plan) so the
 * admin page can pivot it without pulling raw events into Node.
 *
 * security definer + a locked search_path so it can read domain_events (which
 * consumers cannot), and execute is granted to service_role only — the admin
 * page calls it behind admin.tours.manage.
 */
create or replace function public.admin_tour_analytics(p_tour_version_id uuid)
returns table (
  scope text,
  step_id uuid,
  event_type text,
  subscription_plan public.subscription_plan,
  event_count bigint,
  user_count bigint
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  -- Tour-level funnel, broken down by the actor's current plan. Both branches
  -- filter on (resource_type, resource_id), which is exactly
  -- domain_events_resource_idx, so this stays an index lookup rather than a
  -- scan of event history.
  select
    'tour'::text as scope,
    null::uuid as step_id,
    d.event_type,
    coalesce(sub.plan, 'free'::public.subscription_plan) as subscription_plan,
    count(*)::bigint as event_count,
    count(distinct d.actor_id)::bigint as user_count
  from public.domain_events d
  left join public.subscriptions sub
    on sub.user_id = d.actor_id and sub.status in ('active', 'trialing')
  where d.resource_type = 'tour_version'
    and d.resource_id = p_tour_version_id
  group by d.event_type, coalesce(sub.plan, 'free'::public.subscription_plan)

  union all

  -- Per-step counts, for drop-off. Keyed on the step's own uuid, which is why
  -- phase 1 made steps rows: product-event dedupe includes resource_id, so a
  -- shared id would have collapsed every step into one bucket.
  select
    'step'::text as scope,
    d.resource_id as step_id,
    d.event_type,
    null::public.subscription_plan as subscription_plan,
    count(*)::bigint as event_count,
    count(distinct d.actor_id)::bigint as user_count
  from public.domain_events d
  join public.tour_steps s on s.id = d.resource_id
  where d.resource_type = 'tour_step'
    and s.tour_version_id = p_tour_version_id
  group by d.resource_id, d.event_type;
$$;

revoke all on function public.admin_tour_analytics(uuid) from public, anon, authenticated;
grant execute on function public.admin_tour_analytics(uuid) to service_role;

/**
 * How many users a version could currently reach, so a completion rate has a
 * denominator. Counts non-deleted profiles matching the version's plan and
 * cohort rules; percentage rollout is applied in application code because it is
 * a presentation-level estimate, not a stored fact.
 */
create or replace function public.admin_tour_eligible_count(p_tour_version_id uuid)
returns bigint
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with v as (
    select audience, published_at from public.tour_versions where id = p_tour_version_id
  )
  select count(*)::bigint
  from public.profiles p
  left join public.subscriptions sub
    on sub.user_id = p.user_id and sub.status in ('active', 'trialing')
  cross join v
  where p.deleted_at is null
    and coalesce(sub.plan::text, 'free') = any (
      select jsonb_array_elements_text(coalesce(v.audience -> 'plans', '["free","buddy_plus","buddy_pro"]'::jsonb))
    )
    and (
      coalesce(v.audience ->> 'cohort', 'all') = 'all'
      or v.published_at is null
      or (v.audience ->> 'cohort' = 'new' and p.created_at >= v.published_at)
      or (v.audience ->> 'cohort' = 'existing' and p.created_at < v.published_at)
    );
$$;

revoke all on function public.admin_tour_eligible_count(uuid) from public, anon, authenticated;
grant execute on function public.admin_tour_eligible_count(uuid) to service_role;
