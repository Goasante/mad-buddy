-- Canonical financial and subscription-funnel events. Financial outcomes are
-- written only by trusted server routes after Paystack verification. No client
-- policy is intentionally provided.

create table if not exists public.billing_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (event_type in (
    'pricing_viewed',
    'checkout_started',
    'payment_attempted',
    'payment_succeeded',
    'payment_failed',
    'payment_recovered',
    'subscription_activated',
    'subscription_renewed',
    'subscription_cancelled',
    'subscription_expired',
    'plan_upgraded',
    'plan_downgraded'
  )),
  source text not null check (source in (
    'app_server', 'paystack_webhook', 'paystack_verify', 'admin'
  )),
  provider text not null default 'paystack',
  user_id uuid references auth.users(id) on delete set null,
  subscription_id uuid references public.subscriptions(id) on delete set null,
  subscription_plan public.subscription_plan not null default 'free',
  previous_plan public.subscription_plan,
  amount_minor bigint check (amount_minor is null or amount_minor >= 0),
  currency text check (currency is null or currency ~ '^[A-Z]{3}$'),
  transaction_reference text,
  provider_event_id text,
  dedupe_key text not null unique,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists billing_events_occurred_idx
  on public.billing_events(occurred_at desc);
create index if not exists billing_events_type_occurred_idx
  on public.billing_events(event_type, occurred_at desc);
create index if not exists billing_events_user_occurred_idx
  on public.billing_events(user_id, occurred_at desc)
  where user_id is not null;
create index if not exists billing_events_currency_occurred_idx
  on public.billing_events(currency, occurred_at desc)
  where currency is not null;
create index if not exists billing_events_reference_idx
  on public.billing_events(provider, transaction_reference)
  where transaction_reference is not null;

alter table public.billing_events enable row level security;
-- Service-role only. Consumer sessions cannot read financial reporting data.

create or replace function public.get_revenue_subscription_snapshot(p_now timestamptz default now())
returns table (
  stored_plan public.subscription_plan,
  effective_plan public.subscription_plan,
  in_grace boolean,
  grace_expired boolean,
  user_count bigint
)
language sql
security definer
set search_path = pg_catalog, public
as $$
  with resolved as (
    select
      s.plan as stored_plan,
      case
        when s.plan = 'free' then 'free'::public.subscription_plan
        when s.status not in ('active', 'trialing', 'non_renewing', 'past_due', 'attention') then 'free'::public.subscription_plan
        when s.grace_ends_at is not null and s.grace_ends_at <= p_now then 'free'::public.subscription_plan
        when s.grace_ends_at is null
          and s.current_period_end is not null
          and s.current_period_end <= p_now
          and s.status not in ('active', 'trialing') then 'free'::public.subscription_plan
        else s.plan
      end as effective_plan,
      s.status in ('past_due', 'attention')
        and s.grace_ends_at is not null
        and s.grace_ends_at > p_now as in_grace,
      s.status in ('past_due', 'attention')
        and s.grace_ends_at is not null
        and s.grace_ends_at <= p_now as grace_expired
    from public.subscriptions s
    where s.subject_type = 'user'
  )
  select stored_plan, effective_plan, in_grace, grace_expired, count(*)::bigint
  from resolved
  group by stored_plan, effective_plan, in_grace, grace_expired;
$$;

create or replace function public.get_admin_media_storage_summary()
returns table (
  context_type text,
  content_type text,
  object_count bigint,
  original_bytes bigint,
  variant_bytes bigint
)
language sql
security definer
set search_path = pg_catalog, public
as $$
  with variant_totals as (
    select media_asset_id, coalesce(sum(size_bytes), 0)::bigint as bytes
    from public.media_variants
    group by media_asset_id
  )
  select
    a.context_type,
    a.content_type,
    count(*)::bigint,
    coalesce(sum(a.size_bytes), 0)::bigint,
    coalesce(sum(v.bytes), 0)::bigint
  from public.media_assets a
  left join variant_totals v on v.media_asset_id = a.id
  where a.deleted_at is null
    and a.processing_status = 'ready'
    and a.moderation_status in ('active', 'restored')
  group by a.context_type, a.content_type
  order by a.context_type, a.content_type;
$$;

revoke all on function public.get_revenue_subscription_snapshot(timestamptz) from public;
revoke all on function public.get_admin_media_storage_summary() from public;
grant execute on function public.get_revenue_subscription_snapshot(timestamptz) to service_role;
grant execute on function public.get_admin_media_storage_summary() to service_role;

insert into public.admin_role_permissions (role_id, permission_key)
select id, 'admin.revenue.view'
from public.admin_roles
where name in ('super_administrator', 'trust_safety_administrator')
on conflict (role_id, permission_key) do nothing;
