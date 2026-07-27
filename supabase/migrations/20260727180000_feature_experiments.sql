-- Controlled feature experiments
--
-- Experiments never grant entitlements and never replace feature flags. A
-- parent flag is evaluated first, assignments are permanent, and an exposure
-- is recorded only when the application explicitly reports that the assigned
-- surface was rendered. No location or private content is stored.

create table if not exists public.experiments (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z][a-z0-9_]{2,63}$'),
  name text not null check (length(trim(name)) between 3 and 100),
  description text not null check (length(trim(description)) between 3 and 500),
  hypothesis text not null check (length(trim(hypothesis)) between 3 and 1000),
  status text not null default 'draft'
    check (status in ('draft', 'scheduled', 'running', 'paused', 'completed', 'cancelled')),
  parent_feature_flag_id uuid references public.feature_flags(id),
  allocation_percentage integer not null default 100
    check (allocation_percentage between 1 and 100),
  audience text not null default 'all_eligible'
    check (audience in ('all_eligible', 'selected_testers')),
  target_platforms text[] not null default array['web', 'android', 'ios']::text[],
  target_plans public.subscription_plan[] not null
    default array['free', 'buddy_plus', 'buddy_pro']::public.subscription_plan[],
  conflict_group text check (
    conflict_group is null or (
      length(conflict_group) between 2 and 64
      and conflict_group ~ '^[a-z][a-z0-9_]*$'
    )
  ),
  starts_at timestamptz,
  ends_at timestamptz,
  primary_metric text not null check (length(primary_metric) between 2 and 64),
  secondary_metrics text[] not null default '{}'::text[],
  guardrail_metrics text[] not null default '{}'::text[],
  created_by uuid not null,
  started_at timestamptz,
  paused_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (cardinality(target_platforms) > 0),
  check (target_platforms <@ array['web', 'android', 'ios']::text[]),
  check (cardinality(target_plans) > 0),
  check (target_plans <@ array['free', 'buddy_plus', 'buddy_pro']::public.subscription_plan[]),
  check (ends_at is null or starts_at is null or ends_at > starts_at),
  check (cardinality(secondary_metrics) <= 8),
  check (cardinality(guardrail_metrics) <= 8)
);

create index if not exists experiments_status_schedule_idx
  on public.experiments(status, starts_at, ends_at);
create index if not exists experiments_parent_flag_idx
  on public.experiments(parent_feature_flag_id)
  where parent_feature_flag_id is not null;
create index if not exists experiments_conflict_group_idx
  on public.experiments(conflict_group, status)
  where conflict_group is not null;

create table if not exists public.experiment_variants (
  id uuid primary key default gen_random_uuid(),
  experiment_id uuid not null references public.experiments(id),
  key text not null check (key ~ '^(control|variant_[a-z0-9_]{1,48})$'),
  name text not null check (length(trim(name)) between 2 and 80),
  description text not null default '' check (length(description) <= 500),
  weight_basis_points integer not null check (weight_basis_points between 1 and 10000),
  is_control boolean not null default false,
  created_at timestamptz not null default now(),
  unique (experiment_id, key)
);

create unique index if not exists experiment_variants_one_control_idx
  on public.experiment_variants(experiment_id)
  where is_control;
create index if not exists experiment_variants_weight_idx
  on public.experiment_variants(experiment_id, key);

create table if not exists public.experiment_testers (
  id uuid primary key default gen_random_uuid(),
  experiment_id uuid not null references public.experiments(id),
  user_id uuid references auth.users(id) on delete set null,
  added_by uuid not null,
  created_at timestamptz not null default now(),
  unique (experiment_id, user_id)
);

create table if not exists public.experiment_assignments (
  id uuid primary key default gen_random_uuid(),
  experiment_id uuid not null references public.experiments(id),
  user_id uuid references auth.users(id) on delete set null,
  variant_id uuid not null references public.experiment_variants(id),
  assigned_plan public.subscription_plan not null,
  assigned_platform text not null check (assigned_platform in ('web', 'android', 'ios')),
  assigned_at timestamptz not null default now(),
  unique (experiment_id, user_id)
);

create index if not exists experiment_assignments_variant_idx
  on public.experiment_assignments(experiment_id, variant_id);
create index if not exists experiment_assignments_user_idx
  on public.experiment_assignments(user_id, assigned_at desc);

create table if not exists public.experiment_exposures (
  id uuid primary key default gen_random_uuid(),
  experiment_id uuid not null references public.experiments(id),
  assignment_id uuid not null references public.experiment_assignments(id),
  user_id uuid references auth.users(id) on delete set null,
  variant_id uuid not null references public.experiment_variants(id),
  platform text not null check (platform in ('web', 'android', 'ios')),
  first_exposed_at timestamptz not null default now(),
  unique (experiment_id, user_id),
  unique (assignment_id)
);

create index if not exists experiment_exposures_variant_time_idx
  on public.experiment_exposures(experiment_id, variant_id, first_exposed_at);

insert into public.admin_role_permissions (role_id, permission_key)
select id, 'admin.experiments.manage'
from public.admin_roles
where name = 'super_administrator'
on conflict (role_id, permission_key) do nothing;

alter table public.experiments enable row level security;
alter table public.experiment_variants enable row level security;
alter table public.experiment_testers enable row level security;
alter table public.experiment_assignments enable row level security;
alter table public.experiment_exposures enable row level security;

revoke all on table public.experiments from anon, authenticated;
revoke all on table public.experiment_variants from anon, authenticated;
revoke all on table public.experiment_testers from anon, authenticated;
revoke all on table public.experiment_assignments from anon, authenticated;
revoke all on table public.experiment_exposures from anon, authenticated;
grant all on table public.experiments to service_role;
grant all on table public.experiment_variants to service_role;
grant all on table public.experiment_testers to service_role;
grant all on table public.experiment_assignments to service_role;
grant all on table public.experiment_exposures to service_role;

create or replace function public.create_experiment_definition(
  p_definition jsonb,
  p_created_by uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_experiment_id uuid;
  v_variant_count integer;
  v_weight_total integer;
  v_control_count integer;
begin
  if p_created_by is null or jsonb_typeof(p_definition) <> 'object' then
    raise exception using errcode = '22023', message = 'invalid_experiment_definition';
  end if;

  insert into public.experiments (
    id, key, name, description, hypothesis, parent_feature_flag_id,
    allocation_percentage, audience, target_platforms, target_plans,
    conflict_group, starts_at, ends_at, primary_metric, secondary_metrics,
    guardrail_metrics, created_by
  )
  values (
    coalesce(nullif(p_definition->>'id', '')::uuid, gen_random_uuid()),
    p_definition->>'key',
    p_definition->>'name',
    p_definition->>'description',
    p_definition->>'hypothesis',
    nullif(p_definition->>'parent_feature_flag_id', '')::uuid,
    (p_definition->>'allocation_percentage')::integer,
    p_definition->>'audience',
    array(select jsonb_array_elements_text(p_definition->'target_platforms')),
    array(
      select value::public.subscription_plan
      from jsonb_array_elements_text(p_definition->'target_plans') as value
    ),
    nullif(p_definition->>'conflict_group', ''),
    nullif(p_definition->>'starts_at', '')::timestamptz,
    nullif(p_definition->>'ends_at', '')::timestamptz,
    p_definition->>'primary_metric',
    array(select jsonb_array_elements_text(p_definition->'secondary_metrics')),
    array(select jsonb_array_elements_text(p_definition->'guardrail_metrics')),
    p_created_by
  )
  returning id into v_experiment_id;

  insert into public.experiment_variants (
    experiment_id, key, name, description, weight_basis_points, is_control
  )
  select
    v_experiment_id,
    value->>'key',
    value->>'name',
    coalesce(value->>'description', ''),
    (value->>'weight_basis_points')::integer,
    (value->>'is_control')::boolean
  from jsonb_array_elements(p_definition->'variants') as value;

  select count(*), coalesce(sum(weight_basis_points), 0), count(*) filter (where is_control)
  into v_variant_count, v_weight_total, v_control_count
  from public.experiment_variants
  where experiment_id = v_experiment_id;
  if v_variant_count < 2 or v_variant_count > 4 or v_weight_total <> 10000 or v_control_count <> 1 then
    raise exception using errcode = '22023', message = 'invalid_experiment_variants';
  end if;
  return v_experiment_id;
end;
$$;

create or replace function public.process_experiment_schedules()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_started uuid[];
  v_completed uuid[];
  v_changed integer := 0;
begin
  with changed as (
    update public.experiments
    set status = 'running', started_at = coalesce(started_at, v_now), updated_at = v_now
    where status = 'scheduled'
      and starts_at is not null
      and starts_at <= v_now
      and (ends_at is null or ends_at > v_now)
    returning id
  )
  select coalesce(array_agg(id), '{}'::uuid[]) into v_started from changed;

  with changed as (
    update public.experiments
    set status = 'completed', completed_at = coalesce(completed_at, v_now), updated_at = v_now
    where status in ('scheduled', 'running')
      and ends_at is not null
      and ends_at <= v_now
    returning id
  )
  select coalesce(array_agg(id), '{}'::uuid[]) into v_completed from changed;

  insert into public.admin_audit_events (
    actor_id, actor_role, action, target_type, target_id, new_state, reason
  )
  select null, 'system', 'experiment_automatically_started', 'experiment', id::text,
    '{"status":"running"}'::jsonb, 'Scheduled experiment start reached'
  from unnest(v_started) id;

  insert into public.admin_audit_events (
    actor_id, actor_role, action, target_type, target_id, new_state, reason
  )
  select null, 'system', 'experiment_automatically_completed', 'experiment', id::text,
    '{"status":"completed"}'::jsonb, 'Scheduled experiment end reached'
  from unnest(v_completed) id;

  v_changed := cardinality(v_started) + cardinality(v_completed);
  return v_changed;
end;
$$;

create or replace function public.experiment_evidence_immutable()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'UPDATE'
    and old.user_id is not null
    and new.user_id is null
    and to_jsonb(old) - 'user_id' = to_jsonb(new) - 'user_id'
  then
    return new;
  end if;
  raise exception 'Experiment assignment and exposure evidence is immutable';
end;
$$;

drop trigger if exists experiment_assignments_immutable on public.experiment_assignments;
create trigger experiment_assignments_immutable
  before update or delete on public.experiment_assignments
  for each row execute function public.experiment_evidence_immutable();

drop trigger if exists experiment_exposures_immutable on public.experiment_exposures;
create trigger experiment_exposures_immutable
  before update or delete on public.experiment_exposures
  for each row execute function public.experiment_evidence_immutable();

create or replace function public.experiment_structure_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_status text;
  v_experiment_id uuid;
begin
  if tg_op = 'UPDATE'
    and tg_table_name = 'experiment_testers'
    and old.user_id is not null
    and new.user_id is null
    and to_jsonb(old) - 'user_id' = to_jsonb(new) - 'user_id'
  then
    return new;
  end if;
  if tg_op = 'DELETE' then
    v_experiment_id := old.experiment_id;
  else
    v_experiment_id := new.experiment_id;
  end if;
  select status into v_status
  from public.experiments
  where id = v_experiment_id;

  if v_status not in ('draft', 'scheduled') then
    raise exception 'Experiment variants and testers cannot change after launch';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists experiment_variants_structure_guard on public.experiment_variants;
create trigger experiment_variants_structure_guard
  before insert or update or delete on public.experiment_variants
  for each row execute function public.experiment_structure_guard();

drop trigger if exists experiment_testers_structure_guard on public.experiment_testers;
create trigger experiment_testers_structure_guard
  before insert or update or delete on public.experiment_testers
  for each row execute function public.experiment_structure_guard();

create or replace function public.experiment_definition_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Experiment history cannot be deleted';
  end if;

  if old.status not in ('draft', 'scheduled')
    and (
      old.key <> new.key
      or old.parent_feature_flag_id is distinct from new.parent_feature_flag_id
      or old.allocation_percentage <> new.allocation_percentage
      or old.audience <> new.audience
      or old.target_platforms <> new.target_platforms
      or old.target_plans <> new.target_plans
      or old.conflict_group is distinct from new.conflict_group
      or old.primary_metric <> new.primary_metric
      or old.secondary_metrics <> new.secondary_metrics
      or old.guardrail_metrics <> new.guardrail_metrics
    )
  then
    raise exception 'Launched experiment configuration is immutable';
  end if;

  if old.status = 'completed' and new.status <> old.status then
    raise exception 'Completed experiments are terminal';
  end if;
  if old.status = 'cancelled' and new.status <> old.status then
    raise exception 'Cancelled experiments are terminal';
  end if;
  if old.status = 'draft' and new.status not in ('draft', 'scheduled', 'running', 'cancelled') then
    raise exception 'Invalid experiment status transition';
  end if;
  if old.status = 'scheduled' and new.status not in ('scheduled', 'running', 'completed', 'cancelled') then
    raise exception 'Invalid experiment status transition';
  end if;
  if old.status = 'running' and new.status not in ('running', 'paused', 'completed') then
    raise exception 'Invalid experiment status transition';
  end if;
  if old.status = 'paused' and new.status not in ('paused', 'running', 'completed', 'cancelled') then
    raise exception 'Invalid experiment status transition';
  end if;

  new.updated_at := clock_timestamp();
  return new;
end;
$$;

drop trigger if exists experiment_definition_guard on public.experiments;
create trigger experiment_definition_guard
  before update or delete on public.experiments
  for each row execute function public.experiment_definition_guard();

create or replace function public.feature_flag_enabled_for_subject(
  p_flag_id uuid,
  p_user_id uuid,
  p_plan public.subscription_plan,
  p_platform text,
  p_now timestamptz
)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_flag public.feature_flags%rowtype;
  v_rule public.feature_flag_rules%rowtype;
  v_bucket integer;
begin
  if p_flag_id is null then
    return true;
  end if;
  select * into v_flag from public.feature_flags where id = p_flag_id;
  if not found or v_flag.status in ('off', 'archived') then
    return false;
  end if;
  if v_flag.status = 'on' then
    return true;
  end if;

  v_bucket := ((hashtextextended(v_flag.id::text || ':' || p_user_id::text, 9187)
    & 9223372036854775807) % 10000)::integer;
  for v_rule in
    select *
    from public.feature_flag_rules
    where feature_flag_id = v_flag.id
      and (starts_at is null or starts_at <= p_now)
      and (ends_at is null or ends_at > p_now)
      and target_type in ('all', 'subscription_tier')
      and (
        target_type = 'all'
        or (target_type = 'subscription_tier' and target_value = p_plan::text)
      )
    order by case when target_type = 'subscription_tier' then 0 else 1 end, created_at
  loop
    if v_rule.rollout_percentage is null then
      return true;
    end if;
    return v_bucket < v_rule.rollout_percentage * 100;
  end loop;
  return v_flag.default_value;
end;
$$;

create or replace function public.current_experiment_plan(
  p_user_id uuid,
  p_now timestamptz
)
returns public.subscription_plan
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_plan public.subscription_plan := 'free';
begin
  select s.plan into v_plan
  from public.subscriptions s
  where s.user_id = p_user_id
    and s.plan <> 'free'
    and s.status in ('active', 'trialing', 'non_renewing', 'past_due', 'attention')
    and (s.grace_ends_at is null or s.grace_ends_at > p_now)
  limit 1;
  if found then
    return v_plan;
  end if;

  select t.plan into v_plan
  from public.premium_trials t
  where t.user_id = p_user_id
    and t.status = 'active'
    and t.trial_started_at <= p_now
    and t.trial_ends_at > p_now
  order by t.trial_started_at desc
  limit 1;
  return coalesce(v_plan, 'free'::public.subscription_plan);
end;
$$;

create or replace function public.resolve_experiment_assignment(
  p_experiment_key text,
  p_user_id uuid,
  p_platform text
)
returns table (
  experiment_id uuid,
  assignment_id uuid,
  variant_key text,
  variant_name text,
  is_control boolean
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_experiment public.experiments%rowtype;
  v_assignment public.experiment_assignments%rowtype;
  v_variant public.experiment_variants%rowtype;
  v_now timestamptz := clock_timestamp();
  v_plan public.subscription_plan;
  v_allocation_bucket integer;
  v_variant_bucket integer;
  v_cumulative integer := 0;
  v_weight_total integer;
begin
  if p_user_id is null or p_platform not in ('web', 'android', 'ios') then
    return;
  end if;

  perform public.process_experiment_schedules();
  perform pg_advisory_xact_lock(hashtextextended(p_experiment_key || ':' || p_user_id::text, 4813));
  select * into v_experiment
  from public.experiments
  where key = p_experiment_key
    and status = 'running'
    and (starts_at is null or starts_at <= v_now)
    and (ends_at is null or ends_at > v_now);
  if not found or not (p_platform = any(v_experiment.target_platforms)) then
    return;
  end if;

  v_plan := public.current_experiment_plan(p_user_id, v_now);
  if not public.feature_flag_enabled_for_subject(
    v_experiment.parent_feature_flag_id, p_user_id, v_plan, p_platform, v_now
  ) then
    return;
  end if;

  select * into v_assignment
  from public.experiment_assignments
  where experiment_assignments.experiment_id = v_experiment.id
    and user_id = p_user_id;
  if found then
    select * into v_variant from public.experiment_variants where id = v_assignment.variant_id;
    return query select v_experiment.id, v_assignment.id, v_variant.key, v_variant.name, v_variant.is_control;
    return;
  end if;

  if not (v_plan = any(v_experiment.target_plans)) then
    return;
  end if;
  if v_experiment.audience = 'selected_testers' and not exists (
    select 1 from public.experiment_testers t
    where t.experiment_id = v_experiment.id and t.user_id = p_user_id
  ) then
    return;
  end if;
  if v_experiment.conflict_group is not null then
    perform pg_advisory_xact_lock(
      hashtextextended('conflict:' || v_experiment.conflict_group || ':' || p_user_id::text, 4814)
    );
  end if;
  if v_experiment.conflict_group is not null and exists (
    select 1
    from public.experiment_assignments a
    join public.experiments e on e.id = a.experiment_id
    where a.user_id = p_user_id
      and e.id <> v_experiment.id
      and e.conflict_group = v_experiment.conflict_group
      and e.status = 'running'
      and (e.starts_at is null or e.starts_at <= v_now)
      and (e.ends_at is null or e.ends_at > v_now)
      and p_platform = any(e.target_platforms)
      and public.feature_flag_enabled_for_subject(
        e.parent_feature_flag_id, p_user_id, v_plan, p_platform, v_now
      )
  ) then
    return;
  end if;

  v_allocation_bucket := ((hashtextextended(v_experiment.id::text || ':allocation:' || p_user_id::text, 1187)
    & 9223372036854775807) % 10000)::integer;
  if v_allocation_bucket >= v_experiment.allocation_percentage * 100 then
    return;
  end if;

  select coalesce(sum(weight_basis_points), 0) into v_weight_total
  from public.experiment_variants
  where experiment_variants.experiment_id = v_experiment.id;
  if v_weight_total <> 10000 or not exists (
    select 1 from public.experiment_variants
    where experiment_variants.experiment_id = v_experiment.id and is_control
  ) then
    return;
  end if;

  v_variant_bucket := ((hashtextextended(v_experiment.id::text || ':variant:' || p_user_id::text, 2819)
    & 9223372036854775807) % 10000)::integer;
  for v_variant in
    select *
    from public.experiment_variants
    where experiment_variants.experiment_id = v_experiment.id
    order by key
  loop
    v_cumulative := v_cumulative + v_variant.weight_basis_points;
    exit when v_variant_bucket < v_cumulative;
  end loop;

  insert into public.experiment_assignments (
    experiment_id, user_id, variant_id, assigned_plan, assigned_platform, assigned_at
  )
  values (
    v_experiment.id, p_user_id, v_variant.id, v_plan, p_platform, v_now
  )
  on conflict (experiment_id, user_id) do nothing;

  select * into v_assignment
  from public.experiment_assignments
  where experiment_assignments.experiment_id = v_experiment.id
    and user_id = p_user_id;
  select * into v_variant from public.experiment_variants where id = v_assignment.variant_id;
  return query select v_experiment.id, v_assignment.id, v_variant.key, v_variant.name, v_variant.is_control;
end;
$$;

create or replace function public.record_experiment_exposure(
  p_experiment_key text,
  p_user_id uuid,
  p_platform text
)
returns table (
  experiment_id uuid,
  assignment_id uuid,
  variant_key text,
  variant_name text,
  is_control boolean,
  first_exposure boolean
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_resolved record;
  v_exposure_id uuid;
  v_variant_id uuid;
  v_feature_key text := 'core';
begin
  select * into v_resolved
  from public.resolve_experiment_assignment(p_experiment_key, p_user_id, p_platform);
  if not found then
    return;
  end if;
  select id into v_variant_id
  from public.experiment_variants
  where experiment_variants.experiment_id = v_resolved.experiment_id
    and key = v_resolved.variant_key;
  select coalesce(f.key, 'core') into v_feature_key
  from public.experiments e
  left join public.feature_flags f on f.id = e.parent_feature_flag_id
  where e.id = v_resolved.experiment_id;

  insert into public.experiment_exposures (
    experiment_id, assignment_id, user_id, variant_id, platform
  )
  values (
    v_resolved.experiment_id, v_resolved.assignment_id, p_user_id, v_variant_id, p_platform
  )
  on conflict (experiment_id, user_id) do nothing
  returning id into v_exposure_id;

  if v_exposure_id is not null then
    perform public.record_product_event(
      'experiment_exposed', p_user_id, 'experiments',
      v_resolved.experiment_id, v_feature_key, clock_timestamp()
    );
  end if;
  return query select
    v_resolved.experiment_id,
    v_resolved.assignment_id,
    v_resolved.variant_key,
    v_resolved.variant_name,
    v_resolved.is_control,
    v_exposure_id is not null;
end;
$$;

revoke all on function public.feature_flag_enabled_for_subject(uuid, uuid, public.subscription_plan, text, timestamptz) from public;
revoke all on function public.current_experiment_plan(uuid, timestamptz) from public;
revoke all on function public.create_experiment_definition(jsonb, uuid) from public;
revoke all on function public.process_experiment_schedules() from public;
revoke all on function public.resolve_experiment_assignment(text, uuid, text) from public;
revoke all on function public.record_experiment_exposure(text, uuid, text) from public;
grant execute on function public.create_experiment_definition(jsonb, uuid) to service_role;
grant execute on function public.process_experiment_schedules() to service_role;
grant execute on function public.feature_flag_enabled_for_subject(uuid, uuid, public.subscription_plan, text, timestamptz) to service_role;
grant execute on function public.resolve_experiment_assignment(text, uuid, text) to service_role;
grant execute on function public.record_experiment_exposure(text, uuid, text) to service_role;

create or replace function public.capture_notification_opt_out_event()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_old_enabled boolean;
  v_new_enabled boolean;
begin
  v_old_enabled := case
    when jsonb_typeof(old.notification_preferences->'nearby_alerts') = 'boolean'
    then (old.notification_preferences->>'nearby_alerts')::boolean
    else true
  end;
  v_new_enabled := case
    when jsonb_typeof(new.notification_preferences->'nearby_alerts') = 'boolean'
    then (new.notification_preferences->>'nearby_alerts')::boolean
    else true
  end;
  if v_old_enabled and not v_new_enabled then
    perform public.record_product_event(
      'notification_opt_out',
      new.user_id,
      'user_preferences',
      new.id,
      'core',
      clock_timestamp()
    );
  end if;
  return new;
end;
$$;

drop trigger if exists capture_notification_opt_out_event on public.user_preferences;
create trigger capture_notification_opt_out_event
  after update of notification_preferences on public.user_preferences
  for each row execute function public.capture_notification_opt_out_event();

create or replace function public.capture_experiment_activation_milestone()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_event_name text;
begin
  v_event_name := case new.milestone
    when 'profile_completed' then 'profile_completed'
    when 'activated' then 'activation'
    else null
  end;
  if v_event_name is not null then
    perform public.record_product_event(
      v_event_name, new.user_id, 'activation_milestones', new.id, 'core', new.reached_at
    );
  end if;
  return new;
end;
$$;

drop trigger if exists capture_activation_milestone_event on public.activation_milestones;
create trigger capture_activation_milestone_event
  after insert on public.activation_milestones
  for each row execute function public.capture_experiment_activation_milestone();

create or replace function public.capture_notification_permission_event()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform public.record_product_event(
    'notification_permission_accepted',
    new.user_id,
    tg_table_name,
    new.id,
    'core',
    new.created_at
  );
  return new;
end;
$$;

drop trigger if exists capture_web_notification_permission_event on public.push_subscriptions;
create trigger capture_web_notification_permission_event
  after insert on public.push_subscriptions
  for each row execute function public.capture_notification_permission_event();

drop trigger if exists capture_native_notification_permission_event on public.device_push_tokens;
create trigger capture_native_notification_permission_event
  after insert on public.device_push_tokens
  for each row execute function public.capture_notification_permission_event();
