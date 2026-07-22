-- Admin-editable per-tier entitlement overrides. The code registry in
-- lib/billing/entitlements.ts stays the source of DEFAULTS; a row here overrides
-- one entitlement for one plan (free / buddy_plus / buddy_pro). Absence means
-- "use the code default", so this table is purely additive and safe to empty.
create table if not exists public.tier_entitlement_overrides (
  id uuid primary key default gen_random_uuid(),
  plan text not null check (plan in ('free', 'buddy_plus', 'buddy_pro')),
  entitlement_key text not null,
  value_type text not null check (value_type in ('number', 'boolean')),
  numeric_value numeric,
  is_unlimited boolean not null default false,
  boolean_value boolean,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  unique (plan, entitlement_key)
);

-- Service-role only: entitlement resolution and the admin editor both run
-- server-side with the service role, so no anon/authenticated policy is needed.
alter table public.tier_entitlement_overrides enable row level security;
