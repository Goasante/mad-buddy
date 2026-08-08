-- UpFor Stage 5 — coarse place, and an explicit opt-in to nearby discovery.
--
-- Two columns, both defaulting to the safe answer, plus one narrow read
-- policy. No coordinates are stored on the UpFor row, and no existing session
-- changes audience.

-- ---------------------------------------------------------------------------
-- 1. Coarse area tier (Stage 5a).
-- ---------------------------------------------------------------------------
-- The vocabulary is Linkr's, reused rather than reinvented: one idea, one set
-- of words. Server-derived at creation from the canonical proximity engine —
-- the client sends an activity and a duration, never a proximity claim.
--
-- NULLABLE ON PURPOSE, and NULL is the default. A creator may have no usable
-- location, or one too old to stand behind. "We do not know" is a real state
-- and must be representable; the alternative is fabricating a tier, which
-- would put a confident label on a guess.
--
-- Every existing row keeps NULL. There is no factual proximity to backfill:
-- these sessions were created before the column existed, their creators' past
-- locations were never recorded against them, and inventing one now would be
-- manufacturing history.

alter table public.hangout_sessions
  add column if not exists area_tier text
    check (area_tier is null or area_tier in ('close_by', 'nearby', 'wider_area'));

comment on column public.hangout_sessions.area_tier is
  'Coarse proximity band at creation, from Linkr''s vocabulary. Server-derived; never client-supplied. NULL means the creator had no usable location, which is a real state and not "far".';

-- The timestamp the tier was derived from, so staleness is checkable without
-- reading the creator's location row. It records WHEN we knew, never WHERE.
alter table public.hangout_sessions
  add column if not exists area_derived_at timestamptz;

comment on column public.hangout_sessions.area_derived_at is
  'When area_tier was computed. Lets discovery age out a stale tier without reading another user''s location row.';

-- ---------------------------------------------------------------------------
-- 2. Explicit discovery scope (Stage 5b).
-- ---------------------------------------------------------------------------
-- The visibility decision, made by the creator, stored as its own column
-- rather than inferred from anything else.
--
-- DEFAULT 'muddies'. This is the whole safety property of the migration: every
-- row that already exists, and every row created by a client that has not been
-- updated, stays exactly as private as it was. Nobody's past UpFor becomes
-- visible to strangers because a column appeared.
--
-- Deliberately SEPARATE from audience_type. That column narrows WHICH Muddies
-- can see a session (all / close friends / selected). This one decides whether
-- anyone beyond Muddies can. Collapsing them would make "close friends only"
-- and "nearby strangers" points on one scale, which they are not.

alter table public.hangout_sessions
  add column if not exists discovery_scope text not null default 'muddies'
    check (discovery_scope in ('muddies', 'nearby'));

comment on column public.hangout_sessions.discovery_scope is
  'Who may discover this UpFor beyond its audience. Defaults to muddies so no existing session is ever retroactively widened. Separate from audience_type, which narrows within Muddies.';

-- ---------------------------------------------------------------------------
-- 3. Discovery read access.
-- ---------------------------------------------------------------------------
-- The existing "muddies read active hangouts" policy is UNTOUCHED. Muddies
-- visibility keeps working exactly as before, including the ended_at fix from
-- Stage 3.
--
-- This ADDS a second, deliberately minimal path for opted-in sessions.
-- Postgres ORs permissive SELECT policies, so this widens access only for rows
-- whose creator chose it.
--
-- WHAT THIS POLICY DOES NOT DO, and why that is correct:
--
--   It does not check proximity. It cannot — "near" is viewer-relative and
--   depends on two location rows and a distance calculation, which is not
--   expressible here without exposing coordinates to the policy evaluator.
--
--   It does not check freshness, blocks or ghost mode for the same reason:
--   each needs a join that would make this policy both slow and a second,
--   drifting copy of rules that already live in one place.
--
-- So this policy is the OUTER boundary, not the gate. It says "this row is
-- eligible to be considered". Every actual decision — proximity, freshness,
-- blocks, ghost mode, account restrictions — is applied by the server
-- discovery path before a row reaches anyone, using the same helpers Linkr
-- uses. That is the fail-closed arrangement: RLS narrows to opted-in active
-- sessions, and the application narrows from there. Nothing is discoverable
-- because it is merely nearby.

create policy "opted-in upfors are discovery eligible" on public.hangout_sessions
  for select using (
    discovery_scope = 'nearby'
    and status = 'active'
    and ends_at > now()
    and auth.uid() is not null
    -- Never your own row through this path; owners already have full access.
    and owner_id <> auth.uid()
  );

-- Discovery scans exactly this predicate. A full index would carry every
-- Muddies-only session for no benefit.
create index if not exists hangout_sessions_nearby_discovery_idx
  on public.hangout_sessions(ends_at)
  where discovery_scope = 'nearby' and status = 'active';

-- ---------------------------------------------------------------------------
-- Rollback
-- ---------------------------------------------------------------------------
--   drop policy if exists "opted-in upfors are discovery eligible" on public.hangout_sessions;
--   drop index if exists hangout_sessions_nearby_discovery_idx;
--   alter table public.hangout_sessions drop column if exists discovery_scope;
--   alter table public.hangout_sessions drop column if exists area_derived_at;
--   alter table public.hangout_sessions drop column if exists area_tier;
