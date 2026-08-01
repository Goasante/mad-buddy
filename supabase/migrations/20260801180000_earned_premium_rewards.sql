-- Stage 5: renewable premium access earned through trusted Buddy Score.
create table if not exists public.earned_premium_rewards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  reward_plan public.subscription_plan not null check (reward_plan in ('buddy_plus','buddy_pro')),
  source_score_snapshot integer not null check (source_score_snapshot >= 0),
  grant_key text not null unique,
  granted_at timestamptz not null default now(),
  expires_at timestamptz not null,
  grace_ends_at timestamptz,
  ending_notified_at timestamptz,
  rule_version integer not null check (rule_version > 0),
  status text not null check (status in ('active','grace','expired','revoked')),
  revoked_at timestamptz,
  revoke_reason text check (char_length(revoke_reason) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at > granted_at)
);
create index if not exists earned_rewards_user_idx on public.earned_premium_rewards(user_id, status, expires_at desc);
create unique index if not exists earned_rewards_one_open_per_user_idx
  on public.earned_premium_rewards(user_id)
  where status in ('active','grace');
alter table public.earned_premium_rewards enable row level security;
create policy "users read own earned rewards" on public.earned_premium_rewards for select using (auth.uid() = user_id);
-- No client mutation policy. The server-authoritative lifecycle service owns writes.
