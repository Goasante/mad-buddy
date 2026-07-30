-- Moments: Spotlight views and Tune In.
--
-- Additive only. Nothing existing is dropped or altered: `moments`,
-- `moment_reactions` (already unique on moment_id+user_id), the
-- `moment_audience_targets` audience model, the private `media` bucket with its
-- thumb/feed variants, the `public_moments` entitlement and its
-- `can_publish_open_moments()` RLS mirror all stay exactly as they are.
--
-- Two things genuinely did not exist and are added here:
--
--   1. moment_views  — Moments had no view tracking at all, so a creator could
--      never see reach, and Spotlight ranking had no quality signal.
--
--   2. tune_ins      — one-way, private content interest. Deliberately NOT
--      named followers/following: there is no follow graph, no "following"
--      direction is ever exposed, and the creator only ever sees an aggregate.
--
-- Privacy invariants:
--   * No coordinates, distance, routes or location of any kind is stored.
--   * A creator can read AGGREGATE tune-in counts but never the identities:
--     the RLS select policy on tune_ins is restricted to the viewer's own rows.
--   * A viewer list for a Spotlight Moment is never exposed to other viewers.
--
-- Rollback:
--   drop table if exists public.tune_ins, public.moment_views cascade;
--   drop function if exists public.tune_in_counts(uuid[]);
--   drop function if exists public.moment_engagement(uuid[]);

-- ---------------------------------------------------------------------------
-- Views
-- ---------------------------------------------------------------------------

create table if not exists public.moment_views (
  id uuid primary key default gen_random_uuid(),
  moment_id uuid not null references public.moments(id) on delete cascade,
  viewer_id uuid not null references auth.users(id) on delete cascade,
  viewed_at timestamptz not null default now(),
  -- One row per viewer per Moment: a view is "did this person see it", not a
  -- hit counter, so re-opening never inflates reach.
  constraint moment_views_unique unique (moment_id, viewer_id)
);

create index if not exists moment_views_moment_idx on public.moment_views(moment_id);
create index if not exists moment_views_viewer_idx on public.moment_views(viewer_id, viewed_at desc);

alter table public.moment_views enable row level security;

-- A viewer may record and read their OWN view. Nobody reads anyone else's:
-- aggregate reach reaches the author through the service role only, so a
-- Spotlight viewer can never enumerate who else watched.
create policy "moment views owned by viewer" on public.moment_views
  for all using (auth.uid() = viewer_id) with check (auth.uid() = viewer_id);

-- ---------------------------------------------------------------------------
-- Tune In
-- ---------------------------------------------------------------------------

create table if not exists public.tune_ins (
  id uuid primary key default gen_random_uuid(),
  viewer_id uuid not null references auth.users(id) on delete cascade,
  creator_id uuid not null references auth.users(id) on delete cascade,
  -- Which Spotlight Moment led to this, when it came from a post. Lets a
  -- creator see "+36 Tuned In" for a Moment WITHOUT learning who those people
  -- are. Nullable: a tune-in from a profile has no source Moment.
  source_moment_id uuid references public.moments(id) on delete set null,
  created_at timestamptz not null default now(),
  -- One user can tune in to another once.
  constraint tune_ins_unique unique (viewer_id, creator_id),
  constraint tune_ins_not_self check (viewer_id <> creator_id)
);

create index if not exists tune_ins_creator_idx on public.tune_ins(creator_id);
create index if not exists tune_ins_viewer_idx on public.tune_ins(viewer_id, created_at desc);
create index if not exists tune_ins_source_idx on public.tune_ins(source_moment_id)
  where source_moment_id is not null;

alter table public.tune_ins enable row level security;

-- The ONLY select policy: a user reads the creators THEY tuned in to, which is
-- what powers their private "My Tuned In" list. A creator has no policy that
-- lets them read rows pointing at themselves, so "who tuned in to me" is not
-- reachable from a client at all. Counts come from the security-definer
-- aggregate below.
create policy "tune ins owned by viewer" on public.tune_ins
  for all using (auth.uid() = viewer_id) with check (auth.uid() = viewer_id);

-- ---------------------------------------------------------------------------
-- Aggregates
-- ---------------------------------------------------------------------------

/**
 * Public tune-in totals for a set of creators.
 *
 * security definer so it can count rows the caller cannot read individually:
 * this returns "428" and never a single identity. That asymmetry is the whole
 * privacy design of Tune In, so it lives in one function rather than being
 * re-derived per call site.
 */
create or replace function public.tune_in_counts(creator_ids uuid[])
returns table (creator_id uuid, tuned_in_count bigint)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select t.creator_id, count(*)::bigint
  from public.tune_ins t
  where t.creator_id = any(creator_ids)
  group by t.creator_id;
$$;

revoke all on function public.tune_in_counts(uuid[]) from public;
grant execute on function public.tune_in_counts(uuid[]) to authenticated, service_role;

/**
 * Per-Moment engagement aggregates: views, reactions, and tune-ins attributed
 * to that Moment. Counts only, never identities.
 *
 * Exposed to authenticated callers because reaction and view totals are shown
 * on Spotlight cards. The tune-in figure is an attributed COUNT for the post,
 * which is safe for the same reason the creator total is.
 */
create or replace function public.moment_engagement(moment_ids uuid[])
returns table (moment_id uuid, view_count bigint, reaction_count bigint, tuned_in_count bigint)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    m.id,
    (select count(*) from public.moment_views v where v.moment_id = m.id)::bigint,
    (select count(*) from public.moment_reactions r where r.moment_id = m.id)::bigint,
    (select count(*) from public.tune_ins t where t.source_moment_id = m.id)::bigint
  from public.moments m
  where m.id = any(moment_ids);
$$;

revoke all on function public.moment_engagement(uuid[]) from public;
grant execute on function public.moment_engagement(uuid[]) to authenticated, service_role;

-- Supports the Spotlight ranking read (live public Moments, newest first). The
-- existing moments_open_feed_idx covers the same predicate; this one adds
-- expires_at so the live filter is index-served too.
create index if not exists moments_spotlight_live_idx
  on public.moments(expires_at desc, created_at desc)
  where audience_type = 'public' and status = 'active';
