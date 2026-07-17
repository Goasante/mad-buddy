-- Friendship Recaps, Streaks, Achievements, Healthy Engagement
-- (feature architecture batch 11). Additive only: new tables, indexes, RLS.
--
-- Design stance encoded in the schema itself:
--   * Everything here is PRIVATE. No table has a policy letting one user read
--     another's recap, streak, or achievements — there is no shape for a
--     public leaderboard or ranking to be built from (spec §16, §26, §44).
--   * Streaks hang off a friendship, not a user, and qualification requires
--     BOTH sides (enforced in the application layer via mutual event pairs),
--     so one-sided spam cannot sustain one (spec §17).
--   * Recap summaries store aggregated counts only. No message content, no
--     coordinates, no rejected/blocked/report history (spec §4).
--
-- Rollback:
--   drop table if exists public.user_achievements, public.achievement_definitions,
--     public.streak_qualifying_events, public.friendship_streaks,
--     public.recap_preferences, public.friendship_recaps,
--     public.engagement_preferences cascade;

-- ---------------------------------------------------------------------------
-- FEATURE 1: Friendship Recaps (spec §10).
-- ---------------------------------------------------------------------------

create table if not exists public.friendship_recaps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  period_type text not null check (period_type in ('weekly', 'monthly', 'semester', 'annual')),
  period_start timestamptz not null,
  period_end timestamptz not null,
  -- Aggregated counts ONLY. Never message text, place names, or coordinates.
  summary_data jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null default now(),
  viewed_at timestamptz,
  status text not null default 'ready' check (status in ('generating', 'ready', 'failed', 'dismissed')),
  created_at timestamptz not null default now(),
  -- One recap per user per period: a re-run of the job can't duplicate (§12).
  constraint friendship_recaps_unique unique (user_id, period_type, period_start)
);

create table if not exists public.recap_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  weekly_enabled boolean not null default false,
  monthly_enabled boolean not null default true,
  annual_enabled boolean not null default true,
  sharing_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists friendship_recaps_user_idx on public.friendship_recaps(user_id, period_start desc);

alter table public.friendship_recaps enable row level security;
alter table public.recap_preferences enable row level security;

-- A recap belongs to its user. There is deliberately no policy granting any
-- other user access — sharing is an explicit export, not a read grant (§3).
create policy "recaps owner access" on public.friendship_recaps
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "recap preferences owner access" on public.recap_preferences
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- FEATURE 2: Friendship Streaks (spec §20).
-- ---------------------------------------------------------------------------

create table if not exists public.friendship_streaks (
  id uuid primary key default gen_random_uuid(),
  friendship_id uuid not null references public.friendships(id) on delete cascade,
  current_weeks integer not null default 0 check (current_weeks >= 0),
  longest_weeks integer not null default 0 check (longest_weeks >= 0),
  -- ISO week key, e.g. "2026-W29".
  last_qualified_period text,
  status text not null default 'active' check (status in ('active', 'paused', 'ended')),
  paused_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint friendship_streaks_unique unique (friendship_id)
);

create table if not exists public.streak_qualifying_events (
  id uuid primary key default gen_random_uuid(),
  friendship_id uuid not null references public.friendships(id) on delete cascade,
  -- Which side acted. Mutuality is checked by requiring events from BOTH
  -- users within the same period (spec §17).
  actor_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null check (
    event_type in (
      'plan_completed', 'wave_exchanged', 'ping_accepted', 'shared_plan',
      'safe_arrival_completed', 'event_checked_in_together', 'conversation_activity'
    )
  ),
  event_reference_id uuid,
  period_key text not null,
  created_at timestamptz not null default now(),
  -- One qualification per actor per event-type per period (spec §20): repeated
  -- waves in one week cannot inflate anything.
  constraint streak_events_unique unique (friendship_id, actor_id, event_type, period_key)
);

create index if not exists streak_events_period_idx on public.streak_qualifying_events(friendship_id, period_key);

alter table public.friendship_streaks enable row level security;
alter table public.streak_qualifying_events enable row level security;

-- A streak is visible only to the two people in the friendship (spec §16).
create policy "streaks visible to the pair" on public.friendship_streaks
  for select using (
    exists (
      select 1 from public.friendships f
      where f.id = friendship_streaks.friendship_id
        and auth.uid() in (f.user_one_id, f.user_two_id)
    )
  );

create policy "streak events visible to the pair" on public.streak_qualifying_events
  for select using (
    exists (
      select 1 from public.friendships f
      where f.id = streak_qualifying_events.friendship_id
        and auth.uid() in (f.user_one_id, f.user_two_id)
    )
  );

-- ---------------------------------------------------------------------------
-- FEATURE 3: Achievements (spec §29).
-- ---------------------------------------------------------------------------

create table if not exists public.achievement_definitions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text not null,
  category text not null check (category in ('connection', 'community', 'privacy', 'balance', 'safety')),
  criteria_type text not null check (criteria_type in ('first_time', 'count', 'distinct_count')),
  criteria_value integer not null default 1 check (criteria_value > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_achievements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  achievement_code text not null,
  earned_at timestamptz not null default now(),
  viewed_at timestamptz,
  shared_at timestamptz,
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  -- Granted exactly once (spec §32).
  constraint user_achievements_unique unique (user_id, achievement_code)
);

create index if not exists user_achievements_user_idx on public.user_achievements(user_id, earned_at desc);

alter table public.achievement_definitions enable row level security;
alter table public.user_achievements enable row level security;

-- Definitions are public reference data (criteria must be transparent, §32).
create policy "achievement definitions readable" on public.achievement_definitions
  for select using (is_active = true);

-- Earned achievements are private to the user. No cross-user read policy
-- exists, so no leaderboard can be assembled (spec §26, §44).
create policy "user achievements owner access" on public.user_achievements
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- FEATURE 4/5: Healthy engagement + anti-addiction (spec §41, §45, §48).
-- ---------------------------------------------------------------------------

create table if not exists public.engagement_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  recaps_enabled boolean not null default true,
  streaks_enabled boolean not null default true,
  achievements_enabled boolean not null default true,
  streak_notifications_enabled boolean not null default true,
  -- Users may choose a STRICTER budget than the default, never a looser one
  -- (clamped in the application layer).
  daily_notification_budget integer not null default 8 check (daily_notification_budget between 0 and 8),
  exam_mode_until timestamptz,
  exam_mode_allow_close_friends boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Counts pushes actually sent, so the daily budget is enforceable (spec §45).
create table if not exists public.notification_budget_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Local day key, e.g. "2026-07-17".
  day_key text not null,
  sent_count integer not null default 0 check (sent_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notification_budget_usage_unique unique (user_id, day_key)
);

create index if not exists engagement_exam_mode_idx on public.engagement_preferences(exam_mode_until);

alter table public.engagement_preferences enable row level security;
alter table public.notification_budget_usage enable row level security;

create policy "engagement preferences owner access" on public.engagement_preferences
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "notification budget owner read" on public.notification_budget_usage
  for select using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Seed the MVP achievements (spec §54). Criteria are transparent by design.
-- ---------------------------------------------------------------------------

insert into public.achievement_definitions (code, name, description, category, criteria_type, criteria_value)
values
  ('first_muddy', 'First Muddy', 'You added your first Muddy.', 'connection', 'first_time', 1),
  ('first_wave', 'First Wave', 'You sent your first Wave.', 'connection', 'first_time', 1),
  ('first_plan', 'First Plan', 'You completed your first Plan.', 'connection', 'first_time', 1),
  ('plan_maker', 'Plan Maker', 'You completed 5 Plans.', 'connection', 'count', 5),
  ('first_glow', 'First Glow', 'You turned on your glow for the first time.', 'privacy', 'first_time', 1),
  ('privacy_pro', 'Privacy Pro', 'You reviewed your privacy settings.', 'privacy', 'first_time', 1),
  ('circle_builder', 'Circle Builder', 'You created 3 circles.', 'balance', 'count', 3),
  ('balanced_buddy', 'Balanced Buddy', 'You took part across 3 different circles in a month.', 'balance', 'distinct_count', 3),
  ('good_check_in', 'Good Check-In', 'You completed a Safe Arrival.', 'safety', 'first_time', 1),
  ('trusted_contact', 'Trusted Contact', 'You added a trusted Safe Arrival contact.', 'safety', 'first_time', 1)
on conflict (code) do nothing;
