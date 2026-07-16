-- Muddy Circles, Circle Visibility, and Close Friends (feature batch 2).
-- Additive only. Extends the existing friend_circles / circle_members tables
-- (already present since the initial schema) with new nullable/defaulted
-- columns, and adds three new tables. Nothing is dropped or altered
-- destructively. Safe to apply before the corresponding application deploy.
--
-- Rollback:
--   drop table if exists public.visibility_targets, public.visibility_sessions,
--     public.close_friend_relationships cascade;
--   alter table public.friend_circles
--     drop column if exists icon,
--     drop column if exists theme,
--     drop column if exists is_system_circle,
--     drop column if exists archived_at;
--   alter table public.circle_members drop column if exists added_by;

-- ---------------------------------------------------------------------------
-- FEATURE 1: Muddy Circles — extend the existing personal-circle tables.
-- ---------------------------------------------------------------------------

alter table public.friend_circles
  add column if not exists icon text,
  add column if not exists theme text,
  add column if not exists is_system_circle boolean not null default false,
  add column if not exists archived_at timestamptz;

alter table public.circle_members
  add column if not exists added_by uuid references auth.users(id) on delete set null;

create index if not exists friend_circles_owner_active_idx
  on public.friend_circles(user_id)
  where archived_at is null;

-- ---------------------------------------------------------------------------
-- FEATURE 3: Close Friends — private, one-sided priority designation.
-- ---------------------------------------------------------------------------

create table if not exists public.close_friend_relationships (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  friend_id uuid not null references auth.users(id) on delete cascade,
  priority_level text not null default 'standard' check (priority_level in ('standard', 'priority')),
  notification_preference text not null default 'normal' check (
    notification_preference in (
      'always', 'meeting_pings_only', 'very_close_only', 'status_changes', 'normal'
    )
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint close_friends_unique unique (owner_id, friend_id),
  constraint close_friends_not_self check (owner_id <> friend_id)
);

create index if not exists close_friends_owner_idx on public.close_friend_relationships(owner_id);

alter table public.close_friend_relationships enable row level security;

-- Strictly one-sided and private: only the owner can read or write their
-- own Close Friends. The friend is never told and can never query it.
create policy "close friends owner only" on public.close_friend_relationships
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- ---------------------------------------------------------------------------
-- FEATURE 2: Circle Visibility — time-boxed, per-feature audience sessions.
-- ---------------------------------------------------------------------------

create table if not exists public.visibility_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  feature_type text not null default 'glow' check (
    feature_type in ('glow', 'status', 'wave', 'meeting_ping')
  ),
  visibility_mode text not null check (
    visibility_mode in ('all_muddies', 'selected_circles', 'close_friends', 'hidden')
  ),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  source text not null default 'manual' check (
    source in ('manual', 'schedule', 'hangout_mode', 'event_mode')
  ),
  status text not null default 'active' check (status in ('active', 'ended', 'expired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- MVP audience model (spec §25): inclusion by circle, exclusion by user.
create table if not exists public.visibility_targets (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.visibility_sessions(id) on delete cascade,
  target_type text not null check (target_type in ('circle', 'user')),
  target_id uuid not null,
  access_type text not null default 'include' check (access_type in ('include', 'exclude')),
  created_at timestamptz not null default now(),
  constraint visibility_targets_unique unique (session_id, target_type, target_id, access_type)
);

-- Only one active session per feature per user (enforced by app + this index).
create unique index if not exists visibility_sessions_one_active_per_feature
  on public.visibility_sessions(user_id, feature_type)
  where status = 'active';

create index if not exists visibility_sessions_user_status_idx
  on public.visibility_sessions(user_id, feature_type, status);
create index if not exists visibility_targets_session_idx
  on public.visibility_targets(session_id);

alter table public.visibility_sessions enable row level security;
alter table public.visibility_targets enable row level security;

-- A user's visibility configuration is private to them. Viewers never read
-- it directly — access is resolved server-side (service role) via the
-- shared permission service, never exposed through a public endpoint.
create policy "visibility sessions owner only" on public.visibility_sessions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "visibility targets owner only" on public.visibility_targets
  for all using (
    exists (
      select 1 from public.visibility_sessions s
      where s.id = visibility_targets.session_id and s.user_id = auth.uid()
    )
  );
