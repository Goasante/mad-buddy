-- Private relationship notes (Life foundation, Phase 3).
--
-- A note is something ONE person writes about a relationship: "met at Ama's
-- birthday", "works nights on Thursdays". It is authored, never derived —
-- nothing extracts notes from messages, and nothing may without a separate,
-- explicit consent decision that does not exist yet.
--
-- The defining property is asymmetry. Friendship is symmetric (one row per
-- pair); a note is not. It belongs to its author and the subject must never
-- see it, learn of its existence, or be able to infer it. That is why the
-- policies below are author-only in every direction, with no shared read.
--
-- Rollback:
--   drop table if exists public.relationship_notes;

create table if not exists public.relationship_notes (
  id uuid primary key default gen_random_uuid(),
  -- The note belongs to this user, full stop.
  author_id uuid not null references auth.users(id) on delete cascade,
  -- Who it is about. No foreign-key cascade to a friendship: a note survives
  -- unfriending, because the memory does.
  subject_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Author-authored only. Recorded explicitly so a future AI-suggested note
  -- can never be mistaken for something the user wrote themselves.
  source text not null default 'user' check (source in ('user')),
  -- Nobody may write a note about themselves; that is a profile, not a note.
  constraint relationship_notes_not_self check (author_id <> subject_id)
);

create index if not exists relationship_notes_author_idx
  on public.relationship_notes(author_id, subject_id, updated_at desc);

alter table public.relationship_notes enable row level security;

-- Author-only, every operation. There is deliberately NO policy granting the
-- subject any access: a note about you is not yours to read.
drop policy if exists "relationship_notes_select_own" on public.relationship_notes;
create policy "relationship_notes_select_own"
  on public.relationship_notes for select
  using (auth.uid() = author_id);

drop policy if exists "relationship_notes_insert_own" on public.relationship_notes;
create policy "relationship_notes_insert_own"
  on public.relationship_notes for insert
  with check (auth.uid() = author_id and author_id <> subject_id);

drop policy if exists "relationship_notes_update_own" on public.relationship_notes;
create policy "relationship_notes_update_own"
  on public.relationship_notes for update
  using (auth.uid() = author_id)
  with check (auth.uid() = author_id);

drop policy if exists "relationship_notes_delete_own" on public.relationship_notes;
create policy "relationship_notes_delete_own"
  on public.relationship_notes for delete
  using (auth.uid() = author_id);

-- Account deletion removes notes in BOTH directions via the cascades above:
-- the ones you wrote, and the ones written about you. The second is the
-- important half — a deleted account must not leave a trail in other people's
-- private notes.

comment on table public.relationship_notes is
  'Private, author-owned notes about a relationship. Never visible to the subject. Never derived from messages.';
