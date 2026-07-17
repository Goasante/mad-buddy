-- Profiles, Onboarding, Privacy Setup, Location Permission Education,
-- First-Muddy Activation (feature architecture batch 9). Additive: new tables
-- plus new nullable/defaulted columns on the existing profiles table.
--
-- Reuse notes (deliberately NOT recreated):
--   * profiles already exists (username, full_name, bio, avatar_url,
--     visibility_status, is_onboarded). This migration ADDS the batch-9 fields
--     rather than creating a parallel table. `full_name` remains the display
--     name; we do not rename it.
--   * is_onboarded stays for backward compatibility, but spec §23 requires a
--     real state machine, so onboarding_progress becomes the source of truth.
--     is_onboarded is kept in sync as a convenience flag.
--
-- Rollback: drop the new tables; the added columns are harmless if left.
--   drop table if exists public.privacy_setup_versions, public.user_interests,
--     public.profile_field_privacy, public.onboarding_progress cascade;

-- ---------------------------------------------------------------------------
-- Extend profiles (spec §4, §13).
-- ---------------------------------------------------------------------------

alter table public.profiles
  -- Canonical lowercase username, stored separately (spec §7).
  add column if not exists username_normalized text,
  add column if not exists profile_media_id uuid references public.media_assets(id) on delete set null,
  add column if not exists institution text,
  add column if not exists programme text,
  add column if not exists graduation_year integer,
  add column if not exists general_area text,
  add column if not exists pronouns text,
  add column if not exists username_changed_at timestamptz;

-- Backfill the canonical username for existing rows, then enforce uniqueness
-- case-insensitively. Done as an index (not a constraint) so it can be built
-- concurrently later if the table ever grows.
update public.profiles
  set username_normalized = lower(username)
  where username_normalized is null;

create unique index if not exists profiles_username_normalized_unique
  on public.profiles(username_normalized)
  where username_normalized is not null and deleted_at is null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_graduation_year_check') then
    alter table public.profiles add constraint profiles_graduation_year_check
      check (graduation_year is null or graduation_year between 1950 and 2100);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_field_length_check') then
    alter table public.profiles add constraint profiles_field_length_check check (
      (institution is null or char_length(institution) <= 120)
      and (programme is null or char_length(programme) <= 120)
      and (general_area is null or char_length(general_area) <= 80)
      and (pronouns is null or char_length(pronouns) <= 40)
    );
  end if;
end$$;

-- ---------------------------------------------------------------------------
-- Per-field profile privacy (spec §5, §13).
-- ---------------------------------------------------------------------------

create table if not exists public.profile_field_privacy (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  field_name text not null check (
    field_name in ('bio', 'institution', 'programme', 'graduation_year', 'general_area', 'interests', 'pronouns')
  ),
  visibility text not null check (
    visibility in ('only_me', 'approved_muddies', 'close_friends', 'shared_communities')
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profile_field_privacy_unique unique (user_id, field_name)
);

create table if not exists public.user_interests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  interest text not null check (char_length(interest) between 1 and 40),
  created_at timestamptz not null default now(),
  constraint user_interests_unique unique (user_id, interest)
);

create index if not exists profile_field_privacy_user_idx on public.profile_field_privacy(user_id);
create index if not exists user_interests_user_idx on public.user_interests(user_id);

alter table public.profile_field_privacy enable row level security;
alter table public.user_interests enable row level security;

create policy "profile field privacy owner access" on public.profile_field_privacy
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Interests are readable by Muddies; per-field audience narrowing is enforced
-- in the application layer, which is authoritative.
create policy "interests owner access" on public.user_interests
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "interests readable by muddies" on public.user_interests
  for select using (
    exists (
      select 1 from public.friendships f
      where (f.user_one_id = auth.uid() and f.user_two_id = user_interests.user_id)
         or (f.user_two_id = auth.uid() and f.user_one_id = user_interests.user_id)
    )
  );

-- ---------------------------------------------------------------------------
-- Onboarding progress (spec §23, §25) — a state machine, not one boolean.
-- ---------------------------------------------------------------------------

create table if not exists public.onboarding_progress (
  user_id uuid primary key references auth.users(id) on delete cascade,
  current_step text not null default 'not_started' check (
    current_step in (
      'not_started', 'profile_started', 'profile_completed', 'privacy_reviewed',
      'visibility_configured', 'location_prompted', 'first_muddy_added',
      'activated', 'completed'
    )
  ),
  profile_completed_at timestamptz,
  privacy_reviewed_at timestamptz,
  visibility_configured_at timestamptz,
  location_prompted_at timestamptz,
  -- UX signal only. Never trusted as proof of permission — a valid recent
  -- presence update is the only real evidence (spec §48).
  location_permission_result text check (
    location_permission_result in (
      'not_requested', 'pre_prompt_viewed', 'granted', 'granted_approximate',
      'denied', 'denied_permanently', 'revoked', 'unsupported', 'error'
    )
  ),
  first_muddy_added_at timestamptz,
  activated_at timestamptz,
  completed_at timestamptz,
  skipped_optional boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Activation milestones (spec §57). One row per user per milestone.
create table if not exists public.activation_milestones (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  milestone text not null check (
    milestone in (
      'account_created', 'email_verified', 'profile_completed', 'privacy_setup_completed',
      'first_request_sent', 'first_request_accepted', 'first_muddy_added',
      'first_status_created', 'first_wave_sent', 'first_glow_enabled', 'first_plan_created'
    )
  ),
  reached_at timestamptz not null default now(),
  constraint activation_milestones_unique unique (user_id, milestone)
);

create table if not exists public.privacy_setup_versions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  policy_version text not null,
  setup_completed_at timestamptz,
  last_reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists activation_milestones_user_idx on public.activation_milestones(user_id);

alter table public.onboarding_progress enable row level security;
alter table public.activation_milestones enable row level security;
alter table public.privacy_setup_versions enable row level security;

create policy "onboarding progress owner access" on public.onboarding_progress
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "activation milestones owner read" on public.activation_milestones
  for select using (auth.uid() = user_id);

create policy "privacy setup versions owner access" on public.privacy_setup_versions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
