-- Controlled Premium Trials
--
-- Trials are separate from subscriptions. They never write `trialing` into
-- subscriptions and they never contain Paystack identifiers. All timestamps
-- are chosen by the database clock. Trial rows and lifecycle evidence are
-- permanent and append-only so removing a temporary row cannot restore
-- eligibility.

create table if not exists public.premium_trial_config (
  key text primary key default 'default' check (key = 'default'),
  enabled boolean not null default false,
  eligible_plan public.subscription_plan not null default 'buddy_plus'
    check (eligible_plan in ('buddy_plus', 'buddy_pro')),
  duration_days integer not null default 14 check (duration_days between 1 and 60),
  eligibility_rules jsonb not null default
    '{"audience":"all_eligible","minimum_account_age_days":0,"requires_completed_onboarding":true}'::jsonb,
  campaign_source text,
  available_from timestamptz,
  available_until timestamptz,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (campaign_source is null or length(campaign_source) between 1 and 80),
  check (available_until is null or available_from is null or available_until > available_from),
  check (jsonb_typeof(eligibility_rules) = 'object'),
  check (eligibility_rules ? 'audience'),
  check (eligibility_rules ? 'minimum_account_age_days'),
  check (eligibility_rules ? 'requires_completed_onboarding'),
  check ((eligibility_rules->>'audience') in ('all_eligible', 'owner_grant_only')),
  check (jsonb_typeof(eligibility_rules->'minimum_account_age_days') = 'number'),
  check (((eligibility_rules->>'minimum_account_age_days')::integer) between 0 and 3650),
  check (jsonb_typeof(eligibility_rules->'requires_completed_onboarding') = 'boolean')
);

insert into public.premium_trial_config (key)
values ('default')
on conflict (key) do nothing;

create table if not exists public.premium_trials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  plan public.subscription_plan not null check (plan in ('buddy_plus', 'buddy_pro')),
  status text not null default 'active'
    check (status in ('active', 'expired', 'converted', 'cancelled', 'revoked')),
  trial_started_at timestamptz not null,
  trial_ends_at timestamptz not null,
  source text not null default 'self_service'
    check (source in ('self_service', 'owner_grant', 'campaign')),
  campaign_source text,
  owner_override boolean not null default false,
  override_reason text,
  granted_by uuid,
  converted_at timestamptz,
  cancelled_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid,
  revocation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (trial_ends_at > trial_started_at),
  check (not owner_override or (granted_by is not null and length(coalesce(override_reason, '')) >= 3))
);

create index if not exists premium_trials_user_history_idx
  on public.premium_trials(user_id, created_at desc);
create index if not exists premium_trials_active_expiry_idx
  on public.premium_trials(status, trial_ends_at)
  where status = 'active';
create unique index if not exists premium_trials_one_active_per_user_idx
  on public.premium_trials(user_id)
  where status = 'active';

create table if not exists public.premium_trial_events (
  id uuid primary key default gen_random_uuid(),
  trial_id uuid references public.premium_trials(id),
  user_id uuid not null,
  event_type text not null check (
    event_type in (
      'eligible', 'started', 'active', 'ending_soon', 'expired',
      'converted', 'cancelled', 'revoked', 'premium_feature_used'
    )
  ),
  event_key text not null unique,
  feature_key text,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check (jsonb_typeof(metadata) = 'object')
);

create index if not exists premium_trial_events_user_idx
  on public.premium_trial_events(user_id, occurred_at desc);
create index if not exists premium_trial_events_trial_idx
  on public.premium_trial_events(trial_id, occurred_at desc);

create table if not exists public.premium_trial_notifications (
  id uuid primary key default gen_random_uuid(),
  trial_id uuid not null references public.premium_trials(id),
  user_id uuid not null,
  notification_type text not null
    check (notification_type in ('started', 'ending_soon', 'expired', 'converted', 'revoked')),
  delivery_status text not null default 'pending'
    check (delivery_status in ('pending', 'processing', 'delivered', 'failed')),
  attempts integer not null default 0 check (attempts between 0 and 10),
  last_attempt_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (trial_id, notification_type)
);

create index if not exists premium_trial_notifications_pending_idx
  on public.premium_trial_notifications(delivery_status, attempts, created_at)
  where delivery_status in ('pending', 'failed');

-- No browser session can read or mutate trial control records. User-facing
-- state is returned only by authenticated server endpoints after projection.
alter table public.premium_trial_config enable row level security;
alter table public.premium_trials enable row level security;
alter table public.premium_trial_events enable row level security;
alter table public.premium_trial_notifications enable row level security;

revoke all on table public.premium_trial_config from anon, authenticated;
revoke all on table public.premium_trials from anon, authenticated;
revoke all on table public.premium_trial_events from anon, authenticated;
revoke all on table public.premium_trial_notifications from anon, authenticated;
grant all on table public.premium_trial_config to service_role;
grant all on table public.premium_trials to service_role;
grant all on table public.premium_trial_events to service_role;
grant all on table public.premium_trial_notifications to service_role;

create or replace function public.premium_trial_rows_immutable()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Premium trial history cannot be deleted';
  end if;
  if old.user_id <> new.user_id
    or old.plan <> new.plan
    or old.trial_started_at <> new.trial_started_at
    or old.trial_ends_at <> new.trial_ends_at
    or old.source <> new.source
    or old.owner_override <> new.owner_override
    or old.granted_by is distinct from new.granted_by
  then
    raise exception 'Premium trial identity and timing are immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists premium_trial_rows_immutable on public.premium_trials;
create trigger premium_trial_rows_immutable
  before update or delete on public.premium_trials
  for each row execute function public.premium_trial_rows_immutable();

create or replace function public.premium_trial_events_immutable()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  raise exception 'Premium trial lifecycle evidence is immutable';
end;
$$;

drop trigger if exists premium_trial_events_immutable on public.premium_trial_events;
create trigger premium_trial_events_immutable
  before update or delete on public.premium_trial_events
  for each row execute function public.premium_trial_events_immutable();

-- Atomic start. Advisory locking and the partial unique index protect
-- simultaneous requests. Only service_role can execute this function.
create or replace function public.start_premium_trial(
  p_user_id uuid,
  p_owner_override boolean default false,
  p_granted_by uuid default null,
  p_override_reason text default null,
  p_override_plan public.subscription_plan default null,
  p_source text default 'self_service'
)
returns public.premium_trials
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_config public.premium_trial_config%rowtype;
  v_profile public.profiles%rowtype;
  v_trial public.premium_trials%rowtype;
  v_now timestamptz := clock_timestamp();
  v_plan public.subscription_plan;
  v_min_age integer;
  v_requires_onboarding boolean;
begin
  if p_user_id is null then
    raise exception using errcode = '22023', message = 'invalid_user';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 7341));

  select * into v_config from public.premium_trial_config where key = 'default' for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'trial_not_configured';
  end if;

  if p_owner_override then
    if p_granted_by is null or length(trim(coalesce(p_override_reason, ''))) < 3 then
      raise exception using errcode = '22023', message = 'owner_override_requires_reason';
    end if;
    v_plan := coalesce(p_override_plan, v_config.eligible_plan);
  else
    if not v_config.enabled then
      raise exception using errcode = 'P0001', message = 'trials_disabled';
    end if;
    if v_config.available_from is not null and v_now < v_config.available_from then
      raise exception using errcode = 'P0001', message = 'trial_not_available';
    end if;
    if v_config.available_until is not null and v_now >= v_config.available_until then
      raise exception using errcode = 'P0001', message = 'trial_not_available';
    end if;
    if v_config.eligibility_rules->>'audience' = 'owner_grant_only' then
      raise exception using errcode = 'P0001', message = 'owner_grant_required';
    end if;
    v_plan := v_config.eligible_plan;
  end if;

  if v_plan not in ('buddy_plus', 'buddy_pro') then
    raise exception using errcode = '22023', message = 'invalid_trial_plan';
  end if;

  if exists (
    select 1
    from public.subscriptions s
    where s.user_id = p_user_id
      and s.plan <> 'free'
      and s.status in ('active', 'trialing', 'non_renewing', 'past_due', 'attention')
      and (s.grace_ends_at is null or s.grace_ends_at > v_now)
      and (
        s.status in ('active', 'trialing')
        or s.current_period_end is null
        or s.current_period_end > v_now
        or s.grace_ends_at > v_now
      )
  ) then
    raise exception using errcode = 'P0001', message = 'already_paid';
  end if;

  select * into v_profile
  from public.profiles
  where user_id = p_user_id and deleted_at is null;
  if not found then
    raise exception using errcode = 'P0001', message = 'profile_required';
  end if;

  v_min_age := (v_config.eligibility_rules->>'minimum_account_age_days')::integer;
  v_requires_onboarding := (v_config.eligibility_rules->>'requires_completed_onboarding')::boolean;
  if v_requires_onboarding and not v_profile.is_onboarded then
    raise exception using errcode = 'P0001', message = 'onboarding_required';
  end if;
  if v_profile.created_at > v_now - make_interval(days => v_min_age) then
    raise exception using errcode = 'P0001', message = 'account_too_new';
  end if;

  if not p_owner_override and exists (
    select 1 from public.premium_trials where user_id = p_user_id
  ) then
    raise exception using errcode = 'P0001', message = 'trial_already_used';
  end if;

  if exists (
    select 1 from public.premium_trials where user_id = p_user_id and status = 'active'
  ) then
    raise exception using errcode = 'P0001', message = 'trial_already_active';
  end if;

  insert into public.premium_trials (
    user_id, plan, status, trial_started_at, trial_ends_at, source,
    campaign_source, owner_override, override_reason, granted_by
  )
  values (
    p_user_id, v_plan, 'active', v_now,
    v_now + make_interval(days => v_config.duration_days),
    case when p_owner_override then 'owner_grant' else p_source end,
    v_config.campaign_source, p_owner_override,
    nullif(trim(p_override_reason), ''), p_granted_by
  )
  returning * into v_trial;

  insert into public.premium_trial_events (trial_id, user_id, event_type, event_key, metadata, occurred_at)
  values
    (v_trial.id, p_user_id, 'started', 'trial:started:' || v_trial.id::text,
      jsonb_build_object('plan', v_plan, 'source', v_trial.source), v_now),
    (v_trial.id, p_user_id, 'active', 'trial:active:' || v_trial.id::text,
      jsonb_build_object('plan', v_plan), v_now);

  insert into public.premium_trial_notifications (trial_id, user_id, notification_type)
  values (v_trial.id, p_user_id, 'started')
  on conflict (trial_id, notification_type) do nothing;

  return v_trial;
end;
$$;

create or replace function public.convert_premium_trial(
  p_user_id uuid,
  p_paid_plan public.subscription_plan
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_trial public.premium_trials%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if p_paid_plan not in ('buddy_plus', 'buddy_pro') then return null; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 7341));
  select * into v_trial
  from public.premium_trials
  where user_id = p_user_id and status in ('active', 'expired')
  order by trial_started_at desc
  limit 1
  for update;
  if not found then return null; end if;

  update public.premium_trials
  set status = 'converted', converted_at = v_now, updated_at = v_now
  where id = v_trial.id and status in ('active', 'expired');
  if not found then return null; end if;

  insert into public.premium_trial_events (trial_id, user_id, event_type, event_key, metadata, occurred_at)
  values (
    v_trial.id, p_user_id, 'converted', 'trial:converted:' || v_trial.id::text,
    jsonb_build_object('trial_plan', v_trial.plan, 'paid_plan', p_paid_plan), v_now
  )
  on conflict (event_key) do nothing;
  insert into public.premium_trial_notifications (trial_id, user_id, notification_type)
  values (v_trial.id, p_user_id, 'converted')
  on conflict (trial_id, notification_type) do nothing;
  return v_trial.id;
end;
$$;

create or replace function public.end_premium_trial(
  p_trial_id uuid,
  p_action text,
  p_actor_id uuid default null,
  p_reason text default null
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_trial public.premium_trials%rowtype;
  v_now timestamptz := clock_timestamp();
  v_status text;
begin
  if p_action not in ('cancelled', 'revoked') then
    raise exception using errcode = '22023', message = 'invalid_trial_action';
  end if;
  select * into v_trial from public.premium_trials where id = p_trial_id for update;
  if not found or v_trial.status <> 'active' then return false; end if;
  if p_action = 'revoked' and (p_actor_id is null or length(trim(coalesce(p_reason, ''))) < 3) then
    raise exception using errcode = '22023', message = 'revocation_requires_reason';
  end if;

  v_status := p_action;
  update public.premium_trials
  set status = v_status,
      cancelled_at = case when p_action = 'cancelled' then v_now else cancelled_at end,
      revoked_at = case when p_action = 'revoked' then v_now else revoked_at end,
      revoked_by = case when p_action = 'revoked' then p_actor_id else revoked_by end,
      revocation_reason = case when p_action = 'revoked' then trim(p_reason) else revocation_reason end,
      updated_at = v_now
  where id = v_trial.id and status = 'active';
  if not found then return false; end if;

  insert into public.premium_trial_events (trial_id, user_id, event_type, event_key, metadata, occurred_at)
  values (
    v_trial.id, v_trial.user_id, v_status, 'trial:' || v_status || ':' || v_trial.id::text,
    case when p_action = 'revoked' then jsonb_build_object('reason_code', 'owner_revoked') else '{}'::jsonb end,
    v_now
  )
  on conflict (event_key) do nothing;
  if p_action = 'revoked' then
    insert into public.premium_trial_notifications (trial_id, user_id, notification_type)
    values (v_trial.id, v_trial.user_id, 'revoked')
    on conflict (trial_id, notification_type) do nothing;
  end if;
  return true;
end;
$$;

create or replace function public.process_premium_trial_lifecycle()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_trial public.premium_trials%rowtype;
  v_now timestamptz := clock_timestamp();
  v_processed integer := 0;
begin
  for v_trial in
    select * from public.premium_trials
    where status = 'active'
      and trial_ends_at > v_now
      and trial_ends_at <= v_now + interval '24 hours'
    for update skip locked
  loop
    insert into public.premium_trial_events (
      trial_id, user_id, event_type, event_key, metadata, occurred_at
    )
    values (
      v_trial.id, v_trial.user_id, 'ending_soon',
      'trial:ending_soon:' || v_trial.id::text, '{}'::jsonb, v_now
    )
    on conflict (event_key) do nothing;
    if found then
      insert into public.premium_trial_notifications (trial_id, user_id, notification_type)
      values (v_trial.id, v_trial.user_id, 'ending_soon')
      on conflict (trial_id, notification_type) do nothing;
      v_processed := v_processed + 1;
    end if;
  end loop;

  for v_trial in
    select * from public.premium_trials
    where status = 'active' and trial_ends_at <= v_now
    for update skip locked
  loop
    update public.premium_trials
    set status = 'expired', updated_at = v_now
    where id = v_trial.id and status = 'active';
    if found then
      insert into public.premium_trial_events (
        trial_id, user_id, event_type, event_key, metadata, occurred_at
      )
      values (
        v_trial.id, v_trial.user_id, 'expired',
        'trial:expired:' || v_trial.id::text, '{}'::jsonb, v_now
      )
      on conflict (event_key) do nothing;
      insert into public.premium_trial_notifications (trial_id, user_id, notification_type)
      values (v_trial.id, v_trial.user_id, 'expired')
      on conflict (trial_id, notification_type) do nothing;
      v_processed := v_processed + 1;
    end if;
  end loop;
  return v_processed;
end;
$$;

create or replace function public.claim_premium_trial_notifications(p_limit integer default 100)
returns setof public.premium_trial_notifications
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  update public.premium_trial_notifications
  set delivery_status = 'failed', updated_at = clock_timestamp()
  where delivery_status = 'processing'
    and last_attempt_at < clock_timestamp() - interval '10 minutes'
    and attempts < 5;

  return query
  update public.premium_trial_notifications n
  set delivery_status = 'processing',
      attempts = n.attempts + 1,
      last_attempt_at = clock_timestamp(),
      updated_at = clock_timestamp()
  where n.id in (
    select id
    from public.premium_trial_notifications
    where delivery_status in ('pending', 'failed') and attempts < 5
    order by created_at
    for update skip locked
    limit greatest(1, least(p_limit, 500))
  )
  returning n.*;
end;
$$;

revoke all on function public.start_premium_trial(uuid, boolean, uuid, text, public.subscription_plan, text)
  from public, anon, authenticated;
revoke all on function public.convert_premium_trial(uuid, public.subscription_plan)
  from public, anon, authenticated;
revoke all on function public.end_premium_trial(uuid, text, uuid, text)
  from public, anon, authenticated;
revoke all on function public.process_premium_trial_lifecycle()
  from public, anon, authenticated;
revoke all on function public.claim_premium_trial_notifications(integer)
  from public, anon, authenticated;
grant execute on function public.start_premium_trial(uuid, boolean, uuid, text, public.subscription_plan, text)
  to service_role;
grant execute on function public.convert_premium_trial(uuid, public.subscription_plan)
  to service_role;
grant execute on function public.end_premium_trial(uuid, text, uuid, text)
  to service_role;
grant execute on function public.process_premium_trial_lifecycle()
  to service_role;
grant execute on function public.claim_premium_trial_notifications(integer)
  to service_role;

-- Product analytics continues to use its canonical server function, but plan
-- attribution now falls back to a currently active trial only when no paid
-- subscription grants access. Trial access is still never stored as paid.
create or replace function public.record_product_event(
  p_event_name text,
  p_actor_id uuid,
  p_resource_type text,
  p_resource_id uuid,
  p_feature_key text default 'core',
  p_occurred_at timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_event_id uuid;
  v_plan public.subscription_plan := 'free';
  v_feature text := coalesce(nullif(p_feature_key, ''), 'core');
  v_dedupe text;
begin
  if p_actor_id is null or p_event_name is null or p_resource_type is null or p_resource_id is null then
    return null;
  end if;
  if v_feature = 'socialize' and not exists (
    select 1 from public.feature_flags
    where key = 'socialize'
      and (status = 'on' or (status = 'rollout' and default_value = true))
  ) then
    return null;
  end if;

  select case
    when s.plan <> 'free'
      and s.status in ('active', 'trialing', 'non_renewing', 'past_due', 'attention')
      and (s.grace_ends_at is null or s.grace_ends_at > p_occurred_at)
      and (
        s.status in ('active', 'trialing')
        or s.current_period_end is null
        or s.current_period_end > p_occurred_at
        or s.grace_ends_at > p_occurred_at
      )
    then s.plan
    else 'free'::public.subscription_plan
  end
  into v_plan
  from public.subscriptions s
  where s.user_id = p_actor_id;
  v_plan := coalesce(v_plan, 'free'::public.subscription_plan);

  if v_plan = 'free' then
    select t.plan into v_plan
    from public.premium_trials t
    where t.user_id = p_actor_id
      and t.status = 'active'
      and t.trial_started_at <= p_occurred_at
      and t.trial_ends_at > p_occurred_at
    order by t.trial_started_at desc
    limit 1;
    v_plan := coalesce(v_plan, 'free'::public.subscription_plan);
  end if;

  v_dedupe := concat(p_event_name, ':', p_resource_type, ':', p_resource_id::text, ':', p_actor_id::text);
  insert into public.domain_events (
    event_type, version, resource_type, resource_id, actor_id, payload,
    occurred_at, dedupe_key, feature_key, subscription_plan
  )
  values (
    p_event_name, 1, p_resource_type, p_resource_id, p_actor_id, '{}'::jsonb,
    p_occurred_at, v_dedupe, v_feature, v_plan
  )
  on conflict (dedupe_key) where dedupe_key is not null do nothing
  returning id into v_event_id;
  if v_event_id is null then return null; end if;

  insert into public.analytics_daily_user_facts (
    event_date, user_id, event_name, feature_key, subscription_plan,
    action_count, first_occurred_at, last_occurred_at
  )
  values (
    (p_occurred_at at time zone 'UTC')::date, p_actor_id, p_event_name,
    v_feature, v_plan, 1, p_occurred_at, p_occurred_at
  )
  on conflict (event_date, user_id, event_name, feature_key, subscription_plan)
  do update set
    action_count = public.analytics_daily_user_facts.action_count + 1,
    first_occurred_at = least(public.analytics_daily_user_facts.first_occurred_at, excluded.first_occurred_at),
    last_occurred_at = greatest(public.analytics_daily_user_facts.last_occurred_at, excluded.last_occurred_at),
    updated_at = now();
  return v_event_id;
end;
$$;

revoke all on function public.record_product_event(text, uuid, text, uuid, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.record_product_event(text, uuid, text, uuid, text, timestamptz)
  to service_role;

create or replace function public.capture_premium_trial_analytics()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_name text;
begin
  v_name := case
    when new.event_type = 'premium_feature_used' then 'premium_feature_used_during_trial'
    else 'trial_' || new.event_type
  end;
  perform public.record_product_event(
    v_name,
    new.user_id,
    'premium_trial',
    coalesce(new.trial_id, new.user_id),
    coalesce(new.feature_key, 'billing'),
    new.occurred_at
  );
  return new;
end;
$$;

drop trigger if exists premium_trial_analytics_capture on public.premium_trial_events;
create trigger premium_trial_analytics_capture
  after insert on public.premium_trial_events
  for each row execute function public.capture_premium_trial_analytics();
