-- Socialize: temporary opt-in "open to meeting new people nearby" presence.
-- Additive only: one new table, its indexes and RLS. Nothing existing is
-- dropped or altered. Distinct from hangout_sessions on purpose: Hangout Mode
-- is a Muddies-only audience, Socialize discovery is between people who are NOT
-- yet Muddies, so overloading hangout_sessions would make the audience/
-- discovery semantics ambiguous.
--
-- No other user's coordinates are ever stored here. Discovery runs through the
-- service-role application layer, which reuses the existing privacy-safe
-- proximity engine (broad tiers only, never distance/coordinates).
--
-- Rollback: drop table if exists public.socialize_sessions cascade;

create table if not exists public.socialize_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  activity text not null check (
    activity in ('anything', 'coffee', 'food', 'walk', 'study', 'event')
  ),
  note text check (char_length(note) <= 140),
  area_tier text not null check (area_tier in ('close_by', 'nearby', 'wider_area')),
  starts_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ended_at timestamptz,
  status text not null default 'active' check (status in ('active', 'ended', 'expired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at > starts_at)
);

-- One active Socialize session per user (partial unique index).
create unique index if not exists socialize_sessions_one_active_idx
  on public.socialize_sessions(user_id)
  where status = 'active';

-- Discovery scans active, unexpired sessions.
create index if not exists socialize_sessions_active_idx
  on public.socialize_sessions(status, expires_at);

alter table public.socialize_sessions enable row level security;

-- A user has full control of their own session. Other users must never read
-- full session rows directly; discovery happens through the privacy-filtered
-- service-role query. This owner policy is the floor.
create policy "socialize owner full access" on public.socialize_sessions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
