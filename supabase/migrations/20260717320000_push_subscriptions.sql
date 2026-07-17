-- Web push subscriptions (batch 4 deferred transport).
--
-- One row per browser subscription. The endpoint is the identity: pushing to
-- a gone endpoint (404/410) deletes the row. Keys are the standard Web Push
-- p256dh/auth pair — not secrets in themselves, but private to the user.
--
-- Rollback: drop table if exists public.push_subscriptions cascade;

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_idx on public.push_subscriptions(user_id);

alter table public.push_subscriptions enable row level security;

create policy "push subscriptions owner access" on public.push_subscriptions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
