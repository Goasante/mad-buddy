-- Paystack billing migration.
-- Additive only: keeps existing Stripe columns while the app migrates providers.

alter type public.subscription_status add value if not exists 'non_renewing';
alter type public.subscription_status add value if not exists 'attention';

alter table public.subscriptions
  add column if not exists provider text not null default 'paystack',
  add column if not exists paystack_customer_code text,
  add column if not exists paystack_subscription_code text,
  add column if not exists paystack_email_token text,
  add column if not exists paystack_authorization_code text;

create unique index if not exists subscriptions_paystack_customer_code_idx
  on public.subscriptions(paystack_customer_code)
  where paystack_customer_code is not null;

create unique index if not exists subscriptions_paystack_subscription_code_idx
  on public.subscriptions(paystack_subscription_code)
  where paystack_subscription_code is not null;

create table if not exists public.paystack_webhook_events (
  id text primary key,
  type text not null,
  created_at timestamptz not null default now()
);

alter table public.paystack_webhook_events enable row level security;
