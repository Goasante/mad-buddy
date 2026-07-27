-- Financial snapshots, verified payment fees, Owner-entered provider costs,
-- and configurable business alert thresholds. All financial tables are
-- service-role only. No authenticated client policy is intentionally added.

alter table public.billing_events
  add column if not exists provider_fee_minor bigint,
  add column if not exists net_amount_minor bigint,
  add column if not exists fee_status text not null default 'unavailable';

alter table public.billing_events
  drop constraint if exists billing_events_provider_fee_minor_check,
  add constraint billing_events_provider_fee_minor_check check (
    provider_fee_minor is null or provider_fee_minor >= 0
  ),
  drop constraint if exists billing_events_net_amount_minor_check,
  add constraint billing_events_net_amount_minor_check check (
    net_amount_minor is null or net_amount_minor >= 0
  ),
  drop constraint if exists billing_events_fee_status_check,
  add constraint billing_events_fee_status_check check (
    fee_status in ('verified', 'unavailable')
  ),
  drop constraint if exists billing_events_fee_consistency_check,
  add constraint billing_events_fee_consistency_check check (
    (fee_status = 'unavailable' and provider_fee_minor is null and net_amount_minor is null)
    or
    (fee_status = 'verified' and provider_fee_minor is not null and net_amount_minor is not null
      and amount_minor is not null and provider_fee_minor <= amount_minor
      and net_amount_minor = amount_minor - provider_fee_minor)
  );

create index if not exists billing_events_missing_fee_idx
  on public.billing_events(occurred_at asc)
  where event_type = 'payment_succeeded'
    and provider = 'paystack'
    and fee_status = 'unavailable'
    and transaction_reference is not null;

create table if not exists public.financial_snapshots (
  id uuid primary key default gen_random_uuid(),
  snapshot_date date not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  active_free_users bigint not null check (active_free_users >= 0),
  buddy_plus_users bigint not null check (buddy_plus_users >= 0),
  buddy_pro_users bigint not null check (buddy_pro_users >= 0),
  active_paid_subscriptions bigint not null check (active_paid_subscriptions >= 0),
  opening_mrr_minor bigint check (opening_mrr_minor is null or opening_mrr_minor >= 0),
  new_mrr_minor bigint check (new_mrr_minor is null or new_mrr_minor >= 0),
  expansion_mrr_minor bigint check (expansion_mrr_minor is null or expansion_mrr_minor >= 0),
  reactivation_mrr_minor bigint check (reactivation_mrr_minor is null or reactivation_mrr_minor >= 0),
  contraction_mrr_minor bigint check (contraction_mrr_minor is null or contraction_mrr_minor >= 0),
  churned_mrr_minor bigint check (churned_mrr_minor is null or churned_mrr_minor >= 0),
  ending_mrr_minor bigint not null check (ending_mrr_minor >= 0),
  reconciliation_status text not null default 'baseline' check (
    reconciliation_status in ('baseline', 'reconciled', 'reconciliation_required')
  ),
  reconciliation_reason text check (
    reconciliation_reason is null or reconciliation_reason in (
      'opening_snapshot_unavailable',
      'lifecycle_movements_do_not_match_trusted_mrr'
    )
  ),
  reconciliation_difference_minor bigint,
  captured_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint financial_snapshots_date_currency_unique unique (snapshot_date, currency),
  constraint financial_snapshots_reconciliation_consistency check (
    (
      reconciliation_status = 'baseline'
      and opening_mrr_minor is null
      and new_mrr_minor is null
      and expansion_mrr_minor is null
      and reactivation_mrr_minor is null
      and contraction_mrr_minor is null
      and churned_mrr_minor is null
      and reconciliation_reason = 'opening_snapshot_unavailable'
      and reconciliation_difference_minor is null
    )
    or
    (
      reconciliation_status = 'reconciled'
      and opening_mrr_minor is not null
      and new_mrr_minor is not null
      and expansion_mrr_minor is not null
      and reactivation_mrr_minor is not null
      and contraction_mrr_minor is not null
      and churned_mrr_minor is not null
      and reconciliation_reason is null
      and reconciliation_difference_minor = 0
      and opening_mrr_minor + new_mrr_minor + expansion_mrr_minor + reactivation_mrr_minor
        - contraction_mrr_minor - churned_mrr_minor = ending_mrr_minor
    )
    or
    (
      reconciliation_status = 'reconciliation_required'
      and opening_mrr_minor is not null
      and new_mrr_minor is null
      and expansion_mrr_minor is null
      and reactivation_mrr_minor is null
      and contraction_mrr_minor is null
      and churned_mrr_minor is null
      and reconciliation_reason = 'lifecycle_movements_do_not_match_trusted_mrr'
      and reconciliation_difference_minor is not null
      and reconciliation_difference_minor <> 0
    )
  )
);

create index if not exists financial_snapshots_currency_date_idx
  on public.financial_snapshots(currency, snapshot_date desc);

alter table public.financial_snapshots enable row level security;
revoke all on table public.financial_snapshots from anon, authenticated;

create table if not exists public.provider_cost_records (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (char_length(provider) between 1 and 64),
  billing_period date not null check (billing_period = date_trunc('month', billing_period)::date),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  amount_minor bigint not null check (amount_minor >= 0),
  category text not null check (category in ('database', 'hosting', 'email', 'sms', 'media_storage', 'push', 'api', 'other')),
  source text not null check (source in ('manual', 'invoice', 'api')),
  notes text check (notes is null or char_length(notes) <= 500),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint provider_cost_records_period_unique unique (provider, billing_period, currency, category)
);

create index if not exists provider_cost_records_period_idx
  on public.provider_cost_records(billing_period desc, currency, provider);

alter table public.provider_cost_records enable row level security;
revoke all on table public.provider_cost_records from anon, authenticated;

create table if not exists public.business_alert_rules (
  rule_key text primary key check (rule_key in (
    'mrr_drop',
    'cancellation_spike',
    'payment_failure_spike',
    'recovery_rate_drop',
    'infrastructure_cost_spike'
  )),
  enabled boolean not null default true,
  threshold_percent numeric(6,2) not null check (threshold_percent > 0 and threshold_percent <= 1000),
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.business_alert_rules enable row level security;
revoke all on table public.business_alert_rules from anon, authenticated;

insert into public.business_alert_rules (rule_key, threshold_percent) values
  ('mrr_drop', 10),
  ('cancellation_spike', 50),
  ('payment_failure_spike', 50),
  ('recovery_rate_drop', 20),
  ('infrastructure_cost_spike', 25)
on conflict (rule_key) do nothing;

insert into public.admin_role_permissions (role_id, permission_key)
select id, 'admin.revenue.manage'
from public.admin_roles
where name = 'super_administrator'
on conflict (role_id, permission_key) do nothing;
