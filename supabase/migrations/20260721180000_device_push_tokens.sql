-- Native (FCM/APNs) device push tokens.
--
-- Distinct from push_subscriptions, which is Web Push (VAPID) shaped
-- (endpoint + p256dh/auth). A native token is a single opaque string plus its
-- platform. The token is the identity: a token that FCM/APNs reports as
-- unregistered is deleted; re-registering the same token on a new account moves
-- it to that account (onConflict (token) in the register service).
--
-- Rollback: drop table if exists public.device_push_tokens cascade;

create table if not exists public.device_push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token text not null unique,
  platform text not null check (platform in ('android', 'ios')),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists device_push_tokens_user_idx on public.device_push_tokens(user_id);

alter table public.device_push_tokens enable row level security;

-- Owner-only. Writes go through the service role (the register endpoint), but
-- this keeps any direct client read scoped to the owner.
create policy "device push tokens owner access" on public.device_push_tokens
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
