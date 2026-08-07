-- Per-user timeline suppression (Life, Phase 3.1).
--
-- "Clear my timeline" must not delete domain_events. Those events are the
-- rebuildable source of truth AND they are shared: a plan two people attended
-- is a fact for both of them. One person clearing their view must never erase
-- the other person's history.
--
-- So clearing records a CUT-OFF, not a deletion. The timeline query ignores
-- everything at or before `hidden_before` for that one user; the events stay,
-- the other participant is untouched, and future events appear normally.
--
-- A timestamp rather than a boolean, deliberately. A boolean would mean
-- "hidden forever" and could not accommodate events that arrive afterwards —
-- the user would clear once and never see their timeline populate again.
-- Clearing twice simply moves the cut-off forward.
--
-- Rollback:
--   drop table if exists public.life_timeline_resets;

create table if not exists public.life_timeline_resets (
  id uuid primary key default gen_random_uuid(),
  -- Whose view this hides. Never the other participant's.
  user_id uuid not null references auth.users(id) on delete cascade,
  -- The canonical sorted pair, matching domain_events.resource_id.
  relationship_id text not null check (char_length(relationship_id) <= 128),
  -- Events at or before this instant are hidden from this user's timeline.
  hidden_before timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One cut-off per user per relationship. Clearing again moves it forward
-- rather than accumulating rows.
create unique index if not exists life_timeline_resets_unique
  on public.life_timeline_resets(user_id, relationship_id);

alter table public.life_timeline_resets enable row level security;

-- Own rows only, in every direction. A reset is a private preference: the
-- other participant must not be able to detect that it happened.
drop policy if exists "life_timeline_resets_select_own" on public.life_timeline_resets;
create policy "life_timeline_resets_select_own"
  on public.life_timeline_resets for select
  using (auth.uid() = user_id);

drop policy if exists "life_timeline_resets_insert_own" on public.life_timeline_resets;
create policy "life_timeline_resets_insert_own"
  on public.life_timeline_resets for insert
  with check (auth.uid() = user_id);

drop policy if exists "life_timeline_resets_update_own" on public.life_timeline_resets;
create policy "life_timeline_resets_update_own"
  on public.life_timeline_resets for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "life_timeline_resets_delete_own" on public.life_timeline_resets;
create policy "life_timeline_resets_delete_own"
  on public.life_timeline_resets for delete
  using (auth.uid() = user_id);

comment on table public.life_timeline_resets is
  'Per-user timeline cut-offs. Hides a user''s own view of earlier events without deleting them or affecting the other participant.';
