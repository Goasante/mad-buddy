-- Entitlements, subscription changes, promotions (feature architecture batch 10).
-- Additive: new tables plus new nullable/defaulted columns on the existing
-- subscriptions table. Nothing is dropped.
--
-- Reuse notes (deliberately NOT recreated):
--   * subscriptions and paystack_webhook_events already exist from the Paystack
--     billing work. This migration EXTENDS subscriptions (grace/period/cancel
--     fields) rather than creating a parallel table, and keeps the existing
--     webhook-event table as the idempotency ledger (spec §31).
--   * subscription_plans / plan_entitlements are intentionally NOT created:
--     the entitlement matrix lives in code (lib/billing/entitlements.ts) where
--     it is unit-tested and versioned with the app. Only per-subject OVERRIDES
--     need storage, because those vary per user (spec §11).
--
-- Rollback: drop the new tables; the added columns are harmless if left.
--   drop table if exists public.promotion_redemptions, public.promotion_codes,
--     public.downgrade_adjustments, public.subscription_changes,
--     public.entitlement_overrides cascade;

-- ---------------------------------------------------------------------------
-- Extend subscriptions (spec §11, §58).
-- ---------------------------------------------------------------------------

alter table public.subscriptions
  add column if not exists subject_type text not null default 'user',
  add column if not exists current_period_start timestamptz,
  add column if not exists current_period_end timestamptz,
  add column if not exists cancel_at_period_end boolean not null default false,
  add column if not exists trial_ends_at timestamptz,
  -- Grace window after a failed renewal: paid access continues (spec §59).
  add column if not exists grace_ends_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'subscriptions_subject_type_check') then
    alter table public.subscriptions add constraint subscriptions_subject_type_check
      check (subject_type in ('user', 'workspace', 'community'));
  end if;
end$$;

create index if not exists subscriptions_grace_idx on public.subscriptions(status, grace_ends_at);

-- ---------------------------------------------------------------------------
-- Per-subject entitlement overrides (spec §11).
-- ---------------------------------------------------------------------------

create table if not exists public.entitlement_overrides (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null default 'user' check (subject_type in ('user', 'workspace', 'community')),
  subject_id uuid not null,
  entitlement_key text not null check (char_length(entitlement_key) <= 60),
  value_type text not null check (value_type in ('integer', 'boolean')),
  integer_value integer,
  boolean_value boolean,
  reason text check (char_length(reason) <= 200),
  starts_at timestamptz,
  ends_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  -- The value must match its declared type.
  constraint entitlement_overrides_value_present check (
    (value_type = 'integer' and integer_value is not null and boolean_value is null)
    or (value_type = 'boolean' and boolean_value is not null and integer_value is null)
  )
);

create index if not exists entitlement_overrides_subject_idx
  on public.entitlement_overrides(subject_type, subject_id, entitlement_key);

alter table public.entitlement_overrides enable row level security;

-- A user may READ their own overrides (so the UI can explain a granted perk),
-- but never write one — overrides are staff-issued only. No insert/update
-- policy exists, so the service role is the only writer.
create policy "entitlement overrides subject read" on public.entitlement_overrides
  for select using (subject_type = 'user' and subject_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Scheduled changes + downgrade adjustments (spec §49).
-- ---------------------------------------------------------------------------

create table if not exists public.subscription_changes (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid references public.subscriptions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  change_type text not null check (change_type in ('upgrade', 'downgrade', 'cancel', 'reactivate')),
  from_plan text not null check (from_plan in ('free', 'buddy_plus', 'buddy_pro')),
  to_plan text not null check (to_plan in ('free', 'buddy_plus', 'buddy_pro')),
  -- Downgrades and cancellations apply at period end (spec §44).
  effective_at timestamptz,
  status text not null default 'scheduled' check (
    status in ('scheduled', 'applied', 'cancelled', 'failed')
  ),
  requested_at timestamptz not null default now(),
  applied_at timestamptz,
  cancelled_at timestamptz,
  reason text check (char_length(reason) <= 200),
  created_at timestamptz not null default now()
);

-- The user's choices about what to keep when a downgrade lands (spec §46).
-- Recorded BEFORE the change applies, so nothing is deleted by surprise.
create table if not exists public.downgrade_adjustments (
  id uuid primary key default gen_random_uuid(),
  subscription_change_id uuid not null references public.subscription_changes(id) on delete cascade,
  resource_type text not null check (
    resource_type in ('personal_circles', 'close_friends', 'private_groups', 'active_plans', 'storage')
  ),
  resource_id uuid,
  selected_action text not null check (selected_action in ('keep', 'archive', 'revert', 'restrict')),
  status text not null default 'pending' check (status in ('pending', 'applied', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists subscription_changes_user_idx on public.subscription_changes(user_id, status);
create index if not exists subscription_changes_due_idx on public.subscription_changes(status, effective_at);
create index if not exists downgrade_adjustments_change_idx on public.downgrade_adjustments(subscription_change_id);

alter table public.subscription_changes enable row level security;
alter table public.downgrade_adjustments enable row level security;

create policy "subscription changes owner read" on public.subscription_changes
  for select using (auth.uid() = user_id);

create policy "downgrade adjustments owner access" on public.downgrade_adjustments
  for all using (
    exists (
      select 1 from public.subscription_changes c
      where c.id = downgrade_adjustments.subscription_change_id and c.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- Promotions (spec §67, §68).
-- ---------------------------------------------------------------------------

create table if not exists public.promotion_codes (
  id uuid primary key default gen_random_uuid(),
  -- Only a hash is stored, so a database leak yields no redeemable codes.
  code_hash text not null unique,
  discount_type text not null check (discount_type in ('percent', 'fixed', 'trial_extension')),
  discount_value integer not null check (discount_value > 0),
  currency text,
  eligible_plans text[] not null default array['buddy_plus']::text[],
  starts_at timestamptz,
  expires_at timestamptz,
  max_redemptions integer check (max_redemptions > 0),
  redemptions_count integer not null default 0 check (redemptions_count >= 0),
  per_user_limit integer not null default 1 check (per_user_limit > 0),
  status text not null default 'active' check (status in ('active', 'paused', 'expired')),
  created_at timestamptz not null default now()
);

create table if not exists public.promotion_redemptions (
  id uuid primary key default gen_random_uuid(),
  promotion_id uuid not null references public.promotion_codes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  subscription_id uuid references public.subscriptions(id) on delete set null,
  redeemed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  -- One redemption per user per code (per_user_limit defaults to 1).
  constraint promotion_redemptions_unique unique (promotion_id, user_id)
);

create index if not exists promotion_redemptions_user_idx on public.promotion_redemptions(user_id);

alter table public.promotion_codes enable row level security;
alter table public.promotion_redemptions enable row level security;

-- Promotion codes are never publicly readable: enumerating them would let
-- anyone discover unredeemed offers. Validation happens via the service role.
create policy "promotion redemptions owner read" on public.promotion_redemptions
  for select using (auth.uid() = user_id);
