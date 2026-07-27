-- Privacy-safe product analytics built on the existing append-only domain event
-- stream. No content, coordinates, distance, profile fields, or private notes
-- are copied into analytics. UTC is the canonical reporting boundary.
--
-- Practical rollback: remove the analytics_* triggers, the capture_* and
-- record_product_event functions, then drop analytics_daily_user_facts. Keep
-- the additive domain_events columns so recorded history is not destroyed.

alter table public.domain_events
  add column if not exists dedupe_key text,
  add column if not exists feature_key text,
  add column if not exists subscription_plan public.subscription_plan not null default 'free';

create unique index if not exists domain_events_dedupe_idx
  on public.domain_events(dedupe_key)
  where dedupe_key is not null;

create index if not exists domain_events_actor_occurred_idx
  on public.domain_events(actor_id, occurred_at desc)
  where actor_id is not null;

create index if not exists domain_events_feature_occurred_idx
  on public.domain_events(feature_key, occurred_at desc)
  where feature_key is not null;

create table if not exists public.analytics_daily_user_facts (
  id uuid primary key default gen_random_uuid(),
  event_date date not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  event_name text not null check (char_length(event_name) <= 64),
  feature_key text not null default 'core' check (char_length(feature_key) <= 64),
  subscription_plan public.subscription_plan not null default 'free',
  action_count integer not null default 1 check (action_count > 0),
  first_occurred_at timestamptz not null,
  last_occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint analytics_daily_user_facts_unique
    unique (event_date, user_id, event_name, feature_key, subscription_plan)
);

create index if not exists analytics_daily_facts_date_idx
  on public.analytics_daily_user_facts(event_date desc);
create index if not exists analytics_daily_facts_user_date_idx
  on public.analytics_daily_user_facts(user_id, event_date desc);
create index if not exists analytics_daily_facts_feature_date_idx
  on public.analytics_daily_user_facts(feature_key, event_date desc);
create index if not exists analytics_daily_facts_plan_date_idx
  on public.analytics_daily_user_facts(subscription_plan, event_date desc);

alter table public.analytics_daily_user_facts enable row level security;
-- No client policy. Reports use the service role after an explicit admin
-- permission check; consumer sessions cannot read product analytics.

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

  -- A disabled optional feature produces no new activity. Existing events and
  -- aggregates remain untouched for historical reporting.
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
    then s.plan
    else 'free'::public.subscription_plan
  end
  into v_plan
  from public.subscriptions s
  where s.user_id = p_actor_id;
  v_plan := coalesce(v_plan, 'free'::public.subscription_plan);

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

  if v_event_id is null then
    return null;
  end if;

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

revoke all on function public.record_product_event(text, uuid, text, uuid, text, timestamptz) from public;

-- Socialize-sourced requests are still ordinary consent-based Muddy requests;
-- this context records attribution without exposing discovery or location data.
alter table public.friend_requests drop constraint if exists friend_requests_context_type_check;
alter table public.friend_requests add constraint friend_requests_context_type_check
  check (context_type is null or context_type in ('school', 'work', 'church', 'event', 'friend', 'socialize', 'other'));

-- Generic INSERT capture: event name, actor column, feature key, timestamp column.
create or replace function public.capture_product_insert_event()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_row jsonb := to_jsonb(new);
  v_actor uuid;
  v_resource uuid;
  v_time timestamptz := now();
begin
  v_actor := nullif(v_row ->> tg_argv[1], '')::uuid;
  v_resource := nullif(v_row ->> 'id', '')::uuid;
  if tg_nargs > 3 and nullif(v_row ->> tg_argv[3], '') is not null then
    v_time := (v_row ->> tg_argv[3])::timestamptz;
  end if;
  perform public.record_product_event(tg_argv[0], v_actor, tg_table_name, v_resource, tg_argv[2], v_time);
  return new;
end;
$$;

create or replace function public.capture_activation_milestone_event()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_name text;
begin
  v_name := case new.milestone
    when 'profile_completed' then 'profile_completed'
    else null
  end;
  if v_name is not null then
    perform public.record_product_event(v_name, new.user_id, 'activation_milestones', new.id, 'core', new.reached_at);
  end if;
  return new;
end;
$$;

create or replace function public.capture_friend_request_acceptance_event()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.status = 'accepted' and old.status is distinct from new.status then
    perform public.record_product_event('friend_request_accepted', new.receiver_id, 'friend_requests', new.id, 'core', coalesce(new.responded_at, now()));
    if new.context_type = 'socialize' then
      perform public.record_product_event('socialize_connection', new.sender_id, 'friend_requests', new.id, 'socialize', coalesce(new.responded_at, now()));
      perform public.record_product_event('socialize_connection', new.receiver_id, 'friend_requests', new.id, 'socialize', coalesce(new.responded_at, now()));
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.capture_friendship_event()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform public.record_product_event('muddy_added', new.user_one_id, 'friendships', new.id, 'core', new.created_at);
  perform public.record_product_event('muddy_added', new.user_two_id, 'friendships', new.id, 'core', new.created_at);
  return new;
end;
$$;

create or replace function public.capture_hangout_join_event()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.status = 'accepted' and old.status is distinct from new.status then
    perform public.record_product_event('hangout_joined', new.requester_id, 'hangout_requests', new.id, 'hangout', coalesce(new.responded_at, now()));
  end if;
  return new;
end;
$$;

create or replace function public.capture_safe_arrival_completion_event()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.status = 'completed' and old.status is distinct from new.status then
    perform public.record_product_event('safe_arrival_completed', new.traveller_id, 'safe_arrival_sessions', new.id, 'safe_arrival', coalesce(new.confirmed_at, now()));
  end if;
  return new;
end;
$$;

create or replace function public.capture_subscription_event()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'INSERT' then
    if new.plan <> 'free' and new.status in ('active', 'trialing') then
      perform public.record_product_event('subscription_started', new.user_id, 'subscriptions', new.id, 'billing', now());
    end if;
  else
    if new.plan <> 'free' and new.status in ('active', 'trialing')
      and (old.plan = 'free' or old.status not in ('active', 'trialing', 'non_renewing', 'past_due', 'attention')) then
      perform public.record_product_event('subscription_started', new.user_id, 'subscriptions', new.id, 'billing', now());
    end if;
    if new.status in ('cancelled', 'expired', 'non_renewing')
      and old.status is distinct from new.status then
      perform public.record_product_event('subscription_cancelled', new.user_id, 'subscriptions', new.id, 'billing', now());
    end if;
  end if;
  return new;
end;
$$;

-- Idempotently attach authoritative product capture to domain writes.
drop trigger if exists analytics_account_created on public.profiles;
create trigger analytics_account_created after insert on public.profiles
  for each row execute function public.capture_product_insert_event('account_created', 'user_id', 'core', 'created_at');

drop trigger if exists analytics_activation_milestone on public.activation_milestones;
create trigger analytics_activation_milestone after insert on public.activation_milestones
  for each row execute function public.capture_activation_milestone_event();

drop trigger if exists analytics_friend_request_sent on public.friend_requests;
create trigger analytics_friend_request_sent after insert on public.friend_requests
  for each row execute function public.capture_product_insert_event('friend_request_sent', 'sender_id', 'core', 'created_at');
drop trigger if exists analytics_friend_request_accepted on public.friend_requests;
create trigger analytics_friend_request_accepted after update of status on public.friend_requests
  for each row execute function public.capture_friend_request_acceptance_event();

drop trigger if exists analytics_friendship_created on public.friendships;
create trigger analytics_friendship_created after insert on public.friendships
  for each row execute function public.capture_friendship_event();

drop trigger if exists analytics_message_sent on public.messages;
create trigger analytics_message_sent after insert on public.messages
  for each row when (new.sender_id is not null and new.message_type <> 'system')
  execute function public.capture_product_insert_event('message_sent', 'sender_id', 'messages', 'created_at');

drop trigger if exists analytics_wave_sent on public.waves;
create trigger analytics_wave_sent after insert on public.waves
  for each row execute function public.capture_product_insert_event('wave_sent', 'sender_id', 'wave', 'sent_at');
drop trigger if exists analytics_ping_sent on public.meeting_pings;
create trigger analytics_ping_sent after insert on public.meeting_pings
  for each row execute function public.capture_product_insert_event('ping_sent', 'sender_id', 'ping', 'created_at');

drop trigger if exists analytics_hangout_created on public.hangout_sessions;
create trigger analytics_hangout_created after insert on public.hangout_sessions
  for each row execute function public.capture_product_insert_event('hangout_created', 'owner_id', 'hangout', 'created_at');
drop trigger if exists analytics_hangout_joined on public.hangout_requests;
create trigger analytics_hangout_joined after update of status on public.hangout_requests
  for each row execute function public.capture_hangout_join_event();

drop trigger if exists analytics_plan_created on public.plans;
create trigger analytics_plan_created after insert on public.plans
  for each row execute function public.capture_product_insert_event('plan_created', 'creator_id', 'plans', 'created_at');
drop trigger if exists analytics_event_created on public.events;
create trigger analytics_event_created after insert on public.events
  for each row execute function public.capture_product_insert_event('event_created', 'host_id', 'events', 'created_at');
drop trigger if exists analytics_group_created on public.conversations;
create trigger analytics_group_created after insert on public.conversations
  for each row when (new.conversation_type = 'group' and new.created_by is not null)
  execute function public.capture_product_insert_event('group_created', 'created_by', 'groups', 'created_at');

drop trigger if exists analytics_socialize_enabled on public.socialize_sessions;
create trigger analytics_socialize_enabled after insert on public.socialize_sessions
  for each row execute function public.capture_product_insert_event('socialize_enabled', 'user_id', 'socialize', 'created_at');
drop trigger if exists analytics_moment_created on public.moments;
create trigger analytics_moment_created after insert on public.moments
  for each row execute function public.capture_product_insert_event('moment_created', 'author_id', 'moments', 'created_at');

drop trigger if exists analytics_safe_arrival_started on public.safe_arrival_sessions;
create trigger analytics_safe_arrival_started after insert on public.safe_arrival_sessions
  for each row execute function public.capture_product_insert_event('safe_arrival_started', 'traveller_id', 'safe_arrival', 'created_at');
drop trigger if exists analytics_safe_arrival_completed on public.safe_arrival_sessions;
create trigger analytics_safe_arrival_completed after update of status on public.safe_arrival_sessions
  for each row execute function public.capture_safe_arrival_completion_event();

drop trigger if exists analytics_achievement_unlocked on public.user_achievements;
create trigger analytics_achievement_unlocked after insert on public.user_achievements
  for each row execute function public.capture_product_insert_event('achievement_unlocked', 'user_id', 'achievements', 'earned_at');
drop trigger if exists analytics_invite_created on public.invite_links;
create trigger analytics_invite_created after insert on public.invite_links
  for each row execute function public.capture_product_insert_event('invite_created', 'creator_id', 'invites', 'created_at');

drop trigger if exists analytics_subscription_created on public.subscriptions;
create trigger analytics_subscription_created after insert on public.subscriptions
  for each row execute function public.capture_subscription_event();
drop trigger if exists analytics_subscription_changed on public.subscriptions;
create trigger analytics_subscription_changed after update of plan, status on public.subscriptions
  for each row execute function public.capture_subscription_event();

-- Profiles are the canonical account-created source. This also covers accounts
-- that pre-date product analytics without relying on an optional milestone.
insert into public.domain_events (
  event_type, version, resource_type, resource_id, actor_id, payload,
  occurred_at, dedupe_key, feature_key, subscription_plan
)
select
  'account_created', 1, 'profiles', p.id, p.user_id, '{}'::jsonb, p.created_at,
  concat('account_created:profiles:', p.id::text, ':', p.user_id::text),
  'core', coalesce(s.plan, 'free'::public.subscription_plan)
from public.profiles p
left join public.subscriptions s on s.user_id = p.user_id
on conflict (dedupe_key) where dedupe_key is not null do nothing;

-- Existing milestones are trusted historical facts, so one known occurrence
-- may be converted without inventing activity. New interaction events come
-- only from their authoritative domain table triggers above.
insert into public.domain_events (
  event_type, version, resource_type, resource_id, actor_id, payload,
  occurred_at, dedupe_key, feature_key, subscription_plan
)
select
  case am.milestone
    when 'profile_completed' then 'profile_completed'
    when 'first_request_sent' then 'friend_request_sent'
    when 'first_request_accepted' then 'friend_request_accepted'
    when 'first_muddy_added' then 'muddy_added'
    when 'first_wave_sent' then 'wave_sent'
    when 'first_plan_created' then 'plan_created'
  end,
  1, 'activation_milestones', am.id, am.user_id, '{}'::jsonb, am.reached_at,
  concat('milestone:', am.id::text), 'core', coalesce(s.plan, 'free'::public.subscription_plan)
from public.activation_milestones am
left join public.subscriptions s on s.user_id = am.user_id
where am.milestone in (
  'profile_completed', 'first_request_sent',
  'first_request_accepted', 'first_muddy_added', 'first_wave_sent', 'first_plan_created'
)
on conflict (dedupe_key) where dedupe_key is not null do nothing;

insert into public.analytics_daily_user_facts (
  event_date, user_id, event_name, feature_key, subscription_plan,
  action_count, first_occurred_at, last_occurred_at
)
select
  (de.occurred_at at time zone 'UTC')::date,
  de.actor_id,
  de.event_type,
  coalesce(de.feature_key, 'core'),
  de.subscription_plan,
  count(*)::integer,
  min(de.occurred_at),
  max(de.occurred_at)
from public.domain_events de
where de.actor_id is not null
  and de.event_type in (
    'account_created', 'profile_completed', 'friend_request_sent',
    'friend_request_accepted', 'muddy_added', 'wave_sent', 'plan_created'
  )
group by 1, 2, 3, 4, 5
on conflict (event_date, user_id, event_name, feature_key, subscription_plan)
do update set
  action_count = greatest(public.analytics_daily_user_facts.action_count, excluded.action_count),
  first_occurred_at = least(public.analytics_daily_user_facts.first_occurred_at, excluded.first_occurred_at),
  last_occurred_at = greatest(public.analytics_daily_user_facts.last_occurred_at, excluded.last_occurred_at),
  updated_at = now();

insert into public.admin_role_permissions (role_id, permission_key)
select id, 'admin.analytics.view'
from public.admin_roles
where name in ('super_administrator', 'trust_safety_administrator')
on conflict (role_id, permission_key) do nothing;
