-- ---------------------------------------------------------------------------
-- Events 2.0 foundation
--
-- Events could only ever be created one way: creation hardcoded
-- visibility='community' and no UI could change it, so `invite` and `link`
-- existed in the CHECK constraint but no code path could produce them. This
-- migration makes the audience model real, and adds the four things the agreed
-- product needs that had nowhere to live: a published Event location, Event
-- admins, Event Updates with reactions, and Event-scoped Linkr consent.
--
-- ADDITIVE ONLY. Nothing is dropped or rewritten. Every existing Event keeps
-- the exact visibility it has, so code deployed before this migration keeps
-- behaving identically afterwards.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Audience
--
-- Two new values join the existing three. The old CHECK is replaced rather
-- than extended because Postgres has no "extend a check" -- the replacement is
-- a strict superset, so no existing row can fail it.
--
-- LEGACY MEANING IS PRESERVED DELIBERATELY. Every Event in the wild today is
-- `community`, created before an audience picker existed, and those Events are
-- discoverable right now. Rewriting them to `public` would silently
-- redistribute somebody's Event; rewriting them to `invite` would silently
-- hide Events people can currently find. So `community` keeps its current
-- behaviour for rows with no community target, and only becomes restrictive
-- once a target is attached. New Events choose deliberately.
-- ---------------------------------------------------------------------------
alter table public.events drop constraint if exists events_visibility_check;
alter table public.events
  add constraint events_visibility_check
  check (visibility in ('invite', 'link', 'community', 'nearby', 'public'));

-- ---------------------------------------------------------------------------
-- 2. Audience targets -- who an invite/community Event is actually for.
--
-- One row per target. `user` targets are the invited-people list; `community`
-- targets point at a Circle (a group conversation), which is the only real
-- community architecture this product has. No other target types: an unused
-- target type is a policy nobody has written.
-- ---------------------------------------------------------------------------
create table if not exists public.event_audience_targets (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  target_type text not null check (target_type in ('user', 'community')),
  -- Deliberately NOT a foreign key: it points at auth.users for 'user' and
  -- public.conversations for 'community', and one column cannot reference two
  -- tables. Cleanup rides the event_id cascade above.
  target_id uuid not null,
  created_at timestamptz not null default now(),
  constraint event_audience_targets_unique unique (event_id, target_type, target_id)
);

create index if not exists event_audience_targets_event_idx
  on public.event_audience_targets(event_id);
-- The hot path: "may this viewer see this Event?" asks for one user's targets
-- across many events at once.
create index if not exists event_audience_targets_lookup_idx
  on public.event_audience_targets(target_type, target_id);

-- ---------------------------------------------------------------------------
-- 3. Event location -- where the programme is being held.
--
-- PUBLICATION DATA, NOT PRESENCE DATA. These coordinates say where an Event is
-- happening; they are not a person's whereabouts, they do not expire, and the
-- retention rules governing user_locations deliberately do not apply. Never
-- store an attendee position here.
--
-- events.venue_label stays the canonical human label -- it already exists and
-- is already rendered, and duplicating it here would create two labels that
-- can disagree. This table is geo-only.
-- ---------------------------------------------------------------------------
create table if not exists public.event_locations (
  event_id uuid primary key references public.events(id) on delete cascade,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  -- Coarse place names for display. Discovery shows these instead of a
  -- distance, so nobody has to be told how far away they are.
  locality text check (char_length(locality) <= 120),
  region text check (char_length(region) <= 120),
  country_code text check (char_length(country_code) = 2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Bounding-box prefilter for nearby discovery. At this scale a btree on the
-- two coordinates plus an exact distance check in the service is enough;
-- PostGIS would be a dependency bought for a problem we do not have.
create index if not exists event_locations_bbox_idx
  on public.event_locations(latitude, longitude);

-- ---------------------------------------------------------------------------
-- 4. Event admins -- who may speak for the Event.
--
-- Separate from event_circles on purpose. Event Circle membership is capped by
-- the host subscription tier (50 free / 250 plus), which is a fine limit for an
-- optional committee group and an unacceptable one for the people allowed to
-- publish essential updates about a 30,000-person Event.
--
-- The host is NOT stored here. events.host_id remains sole ownership; writing
-- the host into this table too would create two sources of truth for who owns
-- an Event, and a way for them to disagree.
-- ---------------------------------------------------------------------------
create table if not exists public.event_admins (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- One role for now. The column exists so a future role is a value rather
  -- than a schema change; v1 ships only what has defined behaviour.
  role text not null default 'admin' check (role in ('admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint event_admins_unique unique (event_id, user_id)
);

create index if not exists event_admins_event_idx on public.event_admins(event_id);
create index if not exists event_admins_user_idx on public.event_admins(user_id);

-- ---------------------------------------------------------------------------
-- 5. Event Updates -- host broadcast, attached to the Event itself.
--
-- Attached to the EVENT, not to an Event Circle, so reach is never a function
-- of what the host pays. Attendees read and react; only host and Event admins
-- write. No attendee composer and no reply thread: this is a noticeboard, not
-- a room.
-- ---------------------------------------------------------------------------
create table if not exists public.event_updates (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  -- 'high' is for information that changes what somebody has to DO -- a moved
  -- gate, a new time. Not for enthusiasm.
  priority text not null default 'normal' check (priority in ('normal', 'high')),
  -- Set when an update is edited, so the UI can say so rather than silently
  -- changing text people have already been notified about.
  edited_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists event_updates_event_idx
  on public.event_updates(event_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 6. Update reactions -- one per person per update, changeable.
--
-- The unique constraint IS the product rule: reacting again replaces your
-- reaction rather than adding another, so a reaction count counts people
-- rather than taps.
-- ---------------------------------------------------------------------------
create table if not exists public.event_update_reactions (
  id uuid primary key default gen_random_uuid(),
  event_update_id uuid not null references public.event_updates(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  reaction_type text not null check (reaction_type in ('heart', 'fire', 'applause', 'wow')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint event_update_reactions_unique unique (event_update_id, user_id)
);

create index if not exists event_update_reactions_update_idx
  on public.event_update_reactions(event_update_id);

-- ---------------------------------------------------------------------------
-- 7. Event Linkr consent -- a SEPARATE permission from Event Glow.
--
-- check_ins.event_glow_enabled means "show my existing Muddies that I am here".
-- This means "I am open to being shown to eligible new people at this Event".
-- One is about friends knowing where you are; the other is about strangers
-- seeing your profile. Reusing the first column for the second would silently
-- convert one consent into the other, so they get separate storage, separate
-- writes and separate authorization.
--
-- Storage is consent only. Whether somebody is actually discoverable right now
-- is derived at request time from check-in, Event state, blocks and age -- so
-- checking out or the Event ending removes them without any row changing.
-- ---------------------------------------------------------------------------
create table if not exists public.event_linkr_opt_ins (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint event_linkr_opt_ins_unique unique (event_id, user_id)
);

create index if not exists event_linkr_opt_ins_event_idx
  on public.event_linkr_opt_ins(event_id) where enabled;

-- ---------------------------------------------------------------------------
-- 8. Row level security
--
-- Every server path here runs through the service role, which bypasses RLS.
-- These policies exist so the tables stay safe if anything is ever read with an
-- anon/authenticated key -- "no client calls it today" is a fact about today,
-- not a security control.
--
-- General shape: you may read what concerns you, you may write only your own
-- consent, and anything that decides who can SEE an Event is server-only.
-- ---------------------------------------------------------------------------
alter table public.event_audience_targets enable row level security;
alter table public.event_locations enable row level security;
alter table public.event_admins enable row level security;
alter table public.event_updates enable row level security;
alter table public.event_update_reactions enable row level security;
alter table public.event_linkr_opt_ins enable row level security;

-- Audience targets: the host manages their own Event list; an invitee may see
-- THEIR OWN row (enough to know they were invited) but never enumerate the
-- rest of the guest list. Who else was invited to a private wedding is not
-- public information.
create policy "audience targets host manages" on public.event_audience_targets
  for all
  using (exists (select 1 from public.events e where e.id = event_id and e.host_id = auth.uid()))
  with check (exists (select 1 from public.events e where e.id = event_id and e.host_id = auth.uid()));

create policy "audience targets self readable" on public.event_audience_targets
  for select using (target_type = 'user' and target_id = auth.uid());

-- Location: readable for Events the viewer can already reach. A private Event
-- venue must not become globally queryable just because it describes a place
-- rather than a person.
create policy "event locations follow event visibility" on public.event_locations
  for select using (
    exists (
      select 1 from public.events e
      where e.id = event_id
        and e.status <> 'draft'
        and (e.host_id = auth.uid() or e.visibility in ('community', 'nearby', 'public'))
    )
  );

create policy "event locations host writes" on public.event_locations
  for all
  using (exists (select 1 from public.events e where e.id = event_id and e.host_id = auth.uid()))
  with check (exists (select 1 from public.events e where e.id = event_id and e.host_id = auth.uid()));

-- Admins: the list is readable to the people on it and to the host. Only the
-- host may change it, so an admin can never promote themselves or appoint
-- others.
create policy "event admins readable" on public.event_admins
  for select using (
    user_id = auth.uid()
    or exists (select 1 from public.events e where e.id = event_id and e.host_id = auth.uid())
  );

create policy "event admins host manages" on public.event_admins
  for all
  using (exists (select 1 from public.events e where e.id = event_id and e.host_id = auth.uid()))
  with check (exists (select 1 from public.events e where e.id = event_id and e.host_id = auth.uid()));

-- Updates: readable for a reachable Event; writable only by host or admin.
-- Authorship is pinned to the caller so an admin cannot post as somebody else.
create policy "event updates readable" on public.event_updates
  for select using (
    exists (
      select 1 from public.events e
      where e.id = event_id
        and e.status <> 'draft'
        and (e.host_id = auth.uid() or e.visibility in ('community', 'nearby', 'public'))
    )
  );

create policy "event updates authored by host or admin" on public.event_updates
  for insert with check (
    author_id = auth.uid()
    and (
      exists (select 1 from public.events e where e.id = event_id and e.host_id = auth.uid())
      or exists (select 1 from public.event_admins a where a.event_id = event_id and a.user_id = auth.uid())
    )
  );

create policy "event updates edited by author or host" on public.event_updates
  for update
  using (
    author_id = auth.uid()
    or exists (select 1 from public.events e where e.id = event_id and e.host_id = auth.uid())
  )
  with check (
    author_id = auth.uid()
    or exists (select 1 from public.events e where e.id = event_id and e.host_id = auth.uid())
  );

-- Reactions: you manage your own, and you may read counts for updates you can
-- already read.
create policy "reactions readable with update" on public.event_update_reactions
  for select using (
    exists (select 1 from public.event_updates u where u.id = event_update_id)
  );

create policy "reactions owned by reactor" on public.event_update_reactions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Linkr consent: strictly your own row, in every direction. Nobody may
-- enumerate who has opted in at an Event -- that list is exactly what the
-- consent protects. Candidate discovery goes through server logic that checks
-- check-in, blocks and age before revealing anybody.
create policy "linkr opt-in owned by user" on public.event_linkr_opt_ins
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
