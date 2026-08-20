-- ---------------------------------------------------------------------------
-- Linkr 2.0 foundation
--
-- Linkr had no product model of its own. `socialize_sessions` recorded an
-- ephemeral "I am up for something for the next hour" window, and discovery
-- projected the ordinary Mad Buddy profile at strangers. That is the wrong
-- shape for the approved product in two ways:
--
--   1. Being discoverable was a TIMER, not a decision. You could not simply
--      be on Linkr; you had to keep re-arming a session.
--   2. The face strangers saw was the same profile your Muddies see. A
--      stranger-facing surface needs its own content, its own photos, and its
--      own visibility rules -- otherwise "be discoverable" silently means
--      "publish my whole profile".
--
-- So Linkr gets its own profile, its own photos, its own private action log,
-- and its own connection edge. ADDITIVE ONLY: socialize_sessions is left
-- exactly as it is. Nothing is dropped and nothing is rewritten, so anything
-- still reading the old table keeps working.
--
-- THE CENTRAL PRIVACY RULE, expressed in schema rather than in code:
--   a one-sided Connect is visible ONLY to the person who made it.
-- linkr_actions is readable by its author and by nobody else -- not by the
-- recipient, not by a joined query, not by an id guess. Reciprocity is
-- resolved by a SECURITY DEFINER function, which is the only thing in the
-- database permitted to read both sides at once.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Linkr profile -- the stranger-facing surface.
--
-- Separate from `profiles` on purpose. `profiles` is who you are to people who
-- already know you; this is what a stranger is shown when deciding whether to
-- say hello. Different audience, different content, different consent.
--
-- `enabled` is the whole activation model: a boolean the user owns, not a
-- session that expires. Turning it off removes them from candidacy on the next
-- query with no cleanup job involved.
-- ---------------------------------------------------------------------------
create table if not exists public.linkr_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default false,

  -- Intent is a product input, not decoration: candidate policy reads it.
  intent text not null default 'friends'
    check (intent in ('friends', 'dating', 'networking', 'anything')),

  -- Written for strangers, so it is NOT profiles.bio. Someone should be able
  -- to say something here they would not put on their main profile.
  bio text check (char_length(bio) <= 120),

  -- Discovery preferences, in the same coarse vocabulary the proximity engine
  -- already speaks. A NUMERIC RADIUS IS DELIBERATELY ABSENT: there is no
  -- column here that could ever be rendered as a distance.
  discovery_distance text not null default 'around_you'
    check (discovery_distance in ('very_close', 'around_you', 'wider')),

  -- Optional filters, each backed by data that actually exists.
  require_photos boolean not null default false,
  only_active_now boolean not null default false,
  only_new_today boolean not null default false,

  -- Permission for Event Mode to show this person to other attendees. This is
  -- the USER-LEVEL switch ("I am willing to be seen at events at all");
  -- per-Event consent lives in event_linkr_opt_ins and is owned by Events.
  -- Both are required. Neither substitutes for the other.
  event_mode_enabled boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The hot path is "give me enabled Linkr users other than me".
create index if not exists linkr_profiles_enabled_idx
  on public.linkr_profiles(user_id) where enabled;

-- ---------------------------------------------------------------------------
-- 2. Linkr photos -- up to four, one of them primary.
--
-- Rides the existing media_assets pipeline rather than storing a URL, so these
-- photos inherit the validation, variants, moderation status and retention
-- every other image in the product already has.
--
-- Separate from profile_photos because the audiences differ. profile_photos
-- carries a per-photo visibility ('only_me', 'approved_muddies') that would be
-- meaningless here: every Linkr photo is by definition shown to strangers, and
-- a photo you did not want strangers to see simply is not in this table.
-- ---------------------------------------------------------------------------
create table if not exists public.linkr_photos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  media_asset_id uuid not null references public.media_assets(id) on delete cascade,
  -- 0 is the primary photo; 1-3 are showcase slots. Position IS the ordering,
  -- so reordering is an update rather than a delete-and-reinsert.
  position smallint not null check (position between 0 and 3),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint linkr_photos_slot_unique unique (user_id, position)
);

create index if not exists linkr_photos_user_idx
  on public.linkr_photos(user_id, position);

-- ---------------------------------------------------------------------------
-- 3. Linkr actions -- the private decision log.
--
-- One row per (actor, target) pair. THE MOST PRIVACY-SENSITIVE TABLE IN THE
-- PRODUCT: it records that you were interested in someone who may not be
-- interested in you. Its RLS below is written so that the target of an action
-- can never read it, which is what makes an unreciprocated Connect invisible.
--
-- 'pass' and 'connect' share the table because they are the same kind of fact
-- -- a decision this viewer made about that candidate -- and because Undo has
-- to find "my last decision" without asking two tables which came first.
--
-- The unique constraint makes a double-tap idempotent instead of duplicated.
-- ---------------------------------------------------------------------------
create table if not exists public.linkr_actions (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references auth.users(id) on delete cascade,
  target_id uuid not null references auth.users(id) on delete cascade,
  action text not null check (action in ('pass', 'connect')),

  -- Where the decision was made. Carried onto the connection so a conversation
  -- can say "Connected at AfroFuture Night" without Linkr storing anything
  -- about the event itself beyond its id.
  event_id uuid references public.events(id) on delete set null,

  -- A pass is a decision about right now, not a permanent verdict; letting it
  -- lapse is what keeps a thin pool from emptying forever. NULL means "until
  -- I say otherwise" and is what an explicit hide writes.
  expires_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint linkr_actions_no_self check (actor_id <> target_id),
  constraint linkr_actions_unique unique (actor_id, target_id)
);

-- Candidate exclusion reads "everything I have decided about".
create index if not exists linkr_actions_actor_idx
  on public.linkr_actions(actor_id, created_at desc);
-- Reciprocity resolution reads "did this person connect with me". Partial,
-- because a pass is never asked about from this direction.
create index if not exists linkr_actions_reciprocal_idx
  on public.linkr_actions(target_id, actor_id) where action = 'connect';

-- ---------------------------------------------------------------------------
-- 4. Linkr connections -- the mutual edge.
--
-- Exists only when both people independently chose Connect. Stored with an
-- ORDERED PAIR (user_low, user_high) and a unique constraint, so two
-- simultaneous connects cannot produce two rows: the second insert collides
-- with the first rather than racing past it.
--
-- This is NOT a friendship. `friendships` remains the sole authority for
-- Muddies, and nothing here grants Muddy privileges -- no Muddy Glow, no
-- trusted proximity, no Muddy-only permission. Becoming Muddies later is a
-- separate, explicit act through the existing friend request flow.
-- ---------------------------------------------------------------------------
create table if not exists public.linkr_connections (
  id uuid primary key default gen_random_uuid(),
  -- Ordered so that (a,b) and (b,a) are the same row. The CHECK enforces the
  -- ordering rather than trusting every caller to sort correctly.
  user_low uuid not null references auth.users(id) on delete cascade,
  user_high uuid not null references auth.users(id) on delete cascade,

  -- The Event the connection was formed at, if any. Nullable and ON DELETE SET
  -- NULL: a connection outlives the event that occasioned it.
  event_id uuid references public.events(id) on delete set null,

  -- The conversation opened for this pair, filled in when it is created.
  conversation_id uuid references public.conversations(id) on delete set null,

  connected_at timestamptz not null default now(),
  -- Set when either person disconnects. The row is kept rather than deleted so
  -- the pair is not immediately re-suggested to each other.
  ended_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint linkr_connections_ordered check (user_low < user_high),
  constraint linkr_connections_unique unique (user_low, user_high)
);

create index if not exists linkr_connections_low_idx
  on public.linkr_connections(user_low) where ended_at is null;
create index if not exists linkr_connections_high_idx
  on public.linkr_connections(user_high) where ended_at is null;

-- ---------------------------------------------------------------------------
-- 5. Interests -- shared vocabulary for the candidate card.
--
-- A join table rather than a text array so "shared interests" is a set
-- intersection in the database instead of a client-side string comparison, and
-- so the tag vocabulary can be constrained later without a data migration.
-- ---------------------------------------------------------------------------
create table if not exists public.linkr_interests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  interest text not null check (char_length(interest) between 1 and 40),
  created_at timestamptz not null default now(),
  constraint linkr_interests_unique unique (user_id, interest)
);

create index if not exists linkr_interests_user_idx on public.linkr_interests(user_id);

-- ---------------------------------------------------------------------------
-- 6. The mutual-connection transaction.
--
-- SECURITY DEFINER because it is the ONLY thing allowed to read both sides of
-- linkr_actions at once. A caller learns exactly one bit -- whether a mutual
-- connection now exists -- and never learns whether the other person had
-- connected first, or whether they had passed. That asymmetry is the privacy
-- guarantee, and it is enforced here rather than in application code.
--
-- Idempotent and race-safe by construction:
--   * the action upsert collides on (actor_id, target_id)
--   * the connection insert collides on (user_low, user_high)
-- Two simultaneous connects therefore produce one connection, and one of the
-- two calls reports `created = false` for a row it did not insert. Both
-- callers still learn `matched = true`, which is what the UI needs.
-- ---------------------------------------------------------------------------
create or replace function public.linkr_record_connect(
  p_actor uuid,
  p_target uuid,
  p_event_id uuid default null
)
returns table (matched boolean, connection_id uuid, created boolean)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_low uuid;
  v_high uuid;
  v_reciprocal boolean;
  v_connection_id uuid;
  v_created boolean := false;
begin
  if p_actor = p_target then
    raise exception 'linkr: cannot connect with self';
  end if;

  -- Record the interest. ON CONFLICT so a retry or double tap updates rather
  -- than raising, and so changing a pass into a connect is one statement.
  insert into public.linkr_actions (actor_id, target_id, action, event_id, expires_at)
  values (p_actor, p_target, 'connect', p_event_id, null)
  on conflict (actor_id, target_id)
  do update set action = 'connect',
                event_id = coalesce(excluded.event_id, public.linkr_actions.event_id),
                expires_at = null,
                updated_at = now();

  -- Did they already choose us? Only this function may ask.
  select exists (
    select 1 from public.linkr_actions
    where actor_id = p_target and target_id = p_actor and action = 'connect'
  ) into v_reciprocal;

  if not v_reciprocal then
    -- One-sided. No connection, no conversation, and deliberately no
    -- notification: the recipient must not learn that this happened.
    return query select false, null::uuid, false;
    return;
  end if;

  v_low  := least(p_actor, p_target);
  v_high := greatest(p_actor, p_target);

  insert into public.linkr_connections (user_low, user_high, event_id)
  values (v_low, v_high, p_event_id)
  on conflict (user_low, user_high) do nothing
  returning id into v_connection_id;

  if v_connection_id is not null then
    v_created := true;
  else
    -- Either the pair connected before, or we lost the insert race. Both mean
    -- the row exists; re-open it if it had been ended.
    update public.linkr_connections
       set ended_at = null,
           connected_at = case when ended_at is not null then now() else connected_at end,
           updated_at = now()
     where user_low = v_low and user_high = v_high
     returning id into v_connection_id;
  end if;

  return query select true, v_connection_id, v_created;
end;
$fn$;

-- Callable by the SERVER ONLY.
--
-- A client that could call this directly would have a reciprocity oracle: pass
-- any user id, and the return value says whether that person had already
-- connected with you. So execute is revoked from every client-facing role and
-- granted back only to service_role, which is the identity the Linkr server
-- actions use.
--
-- `from public` alone is not enough: PostgreSQL grants EXECUTE on new
-- functions to PUBLIC by default, and anon/authenticated inherit it, but
-- revoking from PUBLIC also strips service_role's inherited grant -- which is
-- why the explicit GRANT below is required rather than optional.
revoke all on function public.linkr_record_connect(uuid, uuid, uuid) from public;
revoke all on function public.linkr_record_connect(uuid, uuid, uuid) from anon;
revoke all on function public.linkr_record_connect(uuid, uuid, uuid) from authenticated;
grant execute on function public.linkr_record_connect(uuid, uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 7. Row level security.
--
-- Server paths use the service role and bypass these. The policies exist so
-- the tables remain safe if ever read with an anon/authenticated key --
-- "no client queries this today" is a fact about today, not a control.
-- ---------------------------------------------------------------------------
alter table public.linkr_profiles enable row level security;
alter table public.linkr_photos enable row level security;
alter table public.linkr_actions enable row level security;
alter table public.linkr_connections enable row level security;
alter table public.linkr_interests enable row level security;

-- Linkr profile: you manage your own, always.
create policy "linkr profile owned by user" on public.linkr_profiles
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Reading somebody ELSE's Linkr profile is deliberately not granted here.
-- Discovery eligibility depends on blocks, age, proximity and action history,
-- none of which a row policy can evaluate honestly. A policy that let any
-- authenticated user select every enabled Linkr profile would BE the directory
-- this product does not have. Candidates arrive through server logic only.

create policy "linkr photos owned by user" on public.linkr_photos
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "linkr interests owned by user" on public.linkr_interests
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Actions: the author, and only ever the author.
--
-- Note what is NOT here: no policy grants `target_id = auth.uid()`. Being the
-- subject of a Connect gives you no right to read the row, which is exactly
-- how a one-sided Connect stays invisible. Reciprocity is resolved only by
-- linkr_record_connect above.
create policy "linkr actions readable by actor" on public.linkr_actions
  for select using (actor_id = auth.uid());
create policy "linkr actions written by actor" on public.linkr_actions
  for insert with check (actor_id = auth.uid());
create policy "linkr actions updated by actor" on public.linkr_actions
  for update using (actor_id = auth.uid()) with check (actor_id = auth.uid());
create policy "linkr actions deleted by actor" on public.linkr_actions
  for delete using (actor_id = auth.uid());

-- Connections: participants only. A mutual connection is a fact about two
-- people and is readable by exactly those two.
create policy "linkr connections readable by participants" on public.linkr_connections
  for select using (user_low = auth.uid() or user_high = auth.uid());
create policy "linkr connections updated by participants" on public.linkr_connections
  for update
  using (user_low = auth.uid() or user_high = auth.uid())
  with check (user_low = auth.uid() or user_high = auth.uid());
-- No INSERT policy: connections are created by linkr_record_connect, never by
-- a client. Being able to insert your own connection row would let anyone
-- manufacture a match with a stranger.
