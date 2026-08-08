-- Linkr discovery deck — passing on a suggestion.
--
-- The deck has three gestures. Two already have homes:
--
--   Wave  -> friend_requests (the existing connection request; unchanged)
--   Open  -> a profile route  (no state at all)
--   Pass  -> nowhere. This table.
--
-- Without a record of passes, a dismissed card returns on the next load and
-- the gesture means nothing. That is the whole reason this table exists, and
-- it deliberately does nothing else.
--
-- WHAT A PASS IS NOT:
--
--   * NOT a block. `blocked_users` already exists, is mutual, and cuts off
--     messaging and visibility in both directions. A pass is one-directional
--     and purely a feed preference — "not now", not "never, and tell them".
--   * NOT visible to the person passed on. There is no read path for the
--     passed user, by policy below, and nothing in the product surfaces it.
--     A rejection someone can see is a rejection that hurts, and the product
--     gains nothing from it.
--   * NOT a signal fed into ranking about the PASSED person. A pass filters
--     that viewer's own feed. It never aggregates into a desirability score,
--     because "how many people passed on you" is exactly the number no social
--     product should ever compute.
--
-- EXPIRY IS THE POINT. A pass carries `expires_at` (default 30 days) rather
-- than lasting forever. Someone you scrolled past on a Tuesday is not someone
-- you rejected for life, and a permanent pass silently shrinks a
-- location-based feed until it is empty — the failure mode is invisible and
-- unrecoverable. Cleanup is a filter on read, so an expired pass simply stops
-- applying whether or not a job ever runs.

create table if not exists public.discovery_passes (
  id uuid primary key default gen_random_uuid(),
  -- The viewer who passed. Their feed, their preference.
  user_id uuid not null references auth.users(id) on delete cascade,
  -- The person passed on. Cascades too: a deleted account leaves no trace in
  -- anyone else's pass list.
  passed_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days'),

  -- Passing on yourself is meaningless and would quietly remove you from your
  -- own feed logic. Rejected at the schema so no action has to remember.
  constraint discovery_passes_not_self check (user_id <> passed_user_id),
  -- One row per pair. A re-pass refreshes the existing row (see the action's
  -- upsert) rather than growing an unbounded log of the same decision.
  constraint discovery_passes_unique_pair unique (user_id, passed_user_id)
);

-- The read path is always "everyone I have passed, that has not expired",
-- which is exactly this index.
create index if not exists discovery_passes_active_idx
  on public.discovery_passes(user_id, expires_at);

alter table public.discovery_passes enable row level security;

-- ---------------------------------------------------------------------------
-- Policies: a pass is private to the person who made it.
-- ---------------------------------------------------------------------------
-- `user_id = auth.uid()` on every policy, with no policy keyed on
-- passed_user_id. That asymmetry is the privacy guarantee: there is no query,
-- for any authenticated user, that returns who passed on them.

create policy "own passes readable" on public.discovery_passes
  for select using (auth.uid() = user_id);

create policy "own passes insertable" on public.discovery_passes
  for insert with check (auth.uid() = user_id);

-- Re-passing refreshes expires_at on the existing row.
create policy "own passes updatable" on public.discovery_passes
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Undo. The gesture is easy to trigger by accident on a touch surface, so
-- reversing it must be equally cheap.
create policy "own passes deletable" on public.discovery_passes
  for delete using (auth.uid() = user_id);

comment on table public.discovery_passes is
  'One-directional, expiring feed preference: people this viewer passed on in Linkr discovery. Not a block, never visible to the passed user, and never aggregated into any score about them.';

comment on column public.discovery_passes.expires_at is
  'A pass fades after 30 days. Filtered on read, so expiry holds even if no cleanup job runs.';
