-- Safe Arrival, Check-ins, Event Glow, and Temporary Event Circles
-- (feature architecture batch 5). Additive only: new tables, indexes, and RLS
-- policies. Nothing is dropped or altered. The existing per-user event_modes
-- table (a personal visibility window) is left untouched; this migration adds
-- the shared `events` entity that check-ins, Event Glow, and event circles
-- hang off. Safe to apply before the corresponding application deploy.
--
-- Privacy note: none of these tables store coordinates. Safe Arrival keeps a
-- destination *label* only; check-ins are voluntary presence assertions, not
-- detected location. No movement history is created anywhere here.
--
-- Rollback: drop the tables below (nothing existing depends on them):
--   drop table if exists public.event_announcements, public.event_circle_members,
--     public.event_circles, public.check_ins, public.safe_arrival_events,
--     public.safe_arrival_contacts, public.safe_arrival_sessions,
--     public.events cascade;

-- ---------------------------------------------------------------------------
-- Shared events entity (host-created, referenced by check-ins/glow/circles).
-- ---------------------------------------------------------------------------

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  description text check (char_length(description) <= 1000),
  venue_label text check (char_length(venue_label) <= 120),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  -- Window in which check-in is permitted, relative to starts_at/ends_at
  -- (spec §25). Bounded so a host can't allow check-in days in advance.
  checkin_opens_minutes_before integer not null default 60 check (
    checkin_opens_minutes_before between 0 and 240
  ),
  visibility text not null default 'invite' check (visibility in ('invite', 'link', 'community')),
  status text not null default 'scheduled' check (
    status in ('draft', 'scheduled', 'active', 'ended', 'cancelled')
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint events_end_after_start check (ends_at > starts_at)
);

create index if not exists events_host_idx on public.events(host_id, status);
create index if not exists events_time_idx on public.events(starts_at);

alter table public.events enable row level security;

create policy "events host full access" on public.events
  for all using (auth.uid() = host_id) with check (auth.uid() = host_id);

-- Any authenticated user may read a non-draft event they can reach by link or
-- invite; fine-grained gating happens in the application layer.
create policy "events readable when published" on public.events
  for select using (status <> 'draft');

-- ---------------------------------------------------------------------------
-- FEATURE 1: Safe Arrival — explicit, temporary, destination-label only.
-- ---------------------------------------------------------------------------

create table if not exists public.safe_arrival_sessions (
  id uuid primary key default gen_random_uuid(),
  traveller_id uuid not null references auth.users(id) on delete cascade,
  destination_type text not null default 'custom' check (
    destination_type in ('custom', 'place', 'event')
  ),
  -- A label, never coordinates (spec §6, §7).
  destination_label text not null check (char_length(destination_label) between 1 and 120),
  destination_event_id uuid references public.events(id) on delete set null,
  expected_arrival_at timestamptz not null,
  grace_period_minutes integer not null default 20 check (grace_period_minutes between 5 and 120),
  note text check (char_length(note) <= 200),
  status text not null default 'active' check (
    status in (
      'draft', 'pending_acknowledgement', 'active', 'grace_period',
      'extended', 'completed', 'cancelled', 'expired', 'unconfirmed'
    )
  ),
  started_at timestamptz not null default now(),
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  -- Set once the unconfirmed alert has gone out, so it fires at most once.
  unconfirmed_notified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.safe_arrival_contacts (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.safe_arrival_sessions(id) on delete cascade,
  contact_user_id uuid not null references auth.users(id) on delete cascade,
  acknowledgement_status text not null default 'pending' check (
    acknowledgement_status in ('pending', 'watching', 'declined')
  ),
  acknowledged_at timestamptz,
  notified_at timestamptz,
  created_at timestamptz not null default now(),
  constraint safe_arrival_contacts_unique unique (session_id, contact_user_id)
);

-- Append-only audit of what happened in a session. Metadata must never carry
-- location data (spec §12).
create table if not exists public.safe_arrival_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.safe_arrival_sessions(id) on delete cascade,
  event_type text not null check (
    event_type in (
      'created', 'acknowledged', 'declined', 'extended',
      'confirmed', 'cancelled', 'unconfirmed_alert'
    )
  ),
  created_by uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Lets a contact stop future Safe Arrival requests from a specific user
-- without telling that user (spec §17).
create table if not exists public.safe_arrival_blocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  blocked_traveller_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint safe_arrival_blocks_unique unique (user_id, blocked_traveller_id),
  constraint safe_arrival_blocks_not_self check (user_id <> blocked_traveller_id)
);

create index if not exists safe_arrival_sessions_traveller_idx
  on public.safe_arrival_sessions(traveller_id, status);
create index if not exists safe_arrival_sessions_due_idx
  on public.safe_arrival_sessions(status, expected_arrival_at);
create index if not exists safe_arrival_contacts_contact_idx
  on public.safe_arrival_contacts(contact_user_id);
create index if not exists safe_arrival_events_session_idx
  on public.safe_arrival_events(session_id, created_at);

alter table public.safe_arrival_sessions enable row level security;
alter table public.safe_arrival_contacts enable row level security;
alter table public.safe_arrival_events enable row level security;
alter table public.safe_arrival_blocks enable row level security;

-- Only the traveller and their chosen contacts may see a session.
create policy "safe arrival traveller full access" on public.safe_arrival_sessions
  for all using (auth.uid() = traveller_id) with check (auth.uid() = traveller_id);

create policy "safe arrival visible to contacts" on public.safe_arrival_sessions
  for select using (
    exists (
      select 1 from public.safe_arrival_contacts c
      where c.session_id = safe_arrival_sessions.id and c.contact_user_id = auth.uid()
    )
  );

create policy "safe arrival contacts visible to participants" on public.safe_arrival_contacts
  for select using (
    auth.uid() = contact_user_id
    or exists (
      select 1 from public.safe_arrival_sessions s
      where s.id = safe_arrival_contacts.session_id and s.traveller_id = auth.uid()
    )
  );

-- A contact may update only their own acknowledgement row.
create policy "safe arrival contact acknowledges own row" on public.safe_arrival_contacts
  for update using (auth.uid() = contact_user_id) with check (auth.uid() = contact_user_id);

create policy "safe arrival events visible to participants" on public.safe_arrival_events
  for select using (
    exists (
      select 1 from public.safe_arrival_sessions s
      where s.id = safe_arrival_events.session_id
        and (
          s.traveller_id = auth.uid()
          or exists (
            select 1 from public.safe_arrival_contacts c
            where c.session_id = s.id and c.contact_user_id = auth.uid()
          )
        )
    )
  );

create policy "safe arrival blocks owner access" on public.safe_arrival_blocks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- FEATURE 2: Check-ins — voluntary presence assertions (never detected).
-- ---------------------------------------------------------------------------

create table if not exists public.check_ins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  context_type text not null check (context_type in ('event', 'plan', 'place', 'circle')),
  context_id uuid not null,
  method text not null default 'manual' check (
    method in ('manual', 'qr', 'code', 'host_assisted')
  ),
  visibility text not null default 'participants' check (
    visibility in ('private', 'participants', 'selected_muddies', 'anonymous_count')
  ),
  status text not null default 'checked_in' check (
    status in ('checked_in', 'checked_out', 'revoked', 'invalidated')
  ),
  -- Event Glow is opt-in per check-in (spec §34): being present never implies
  -- being visible.
  event_glow_enabled boolean not null default true,
  checked_in_at timestamptz not null default now(),
  checked_out_at timestamptz,
  verified_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One live check-in per (user, context): duplicate prevention (spec §30, §31).
create unique index if not exists check_ins_one_active_per_context
  on public.check_ins(user_id, context_type, context_id)
  where status = 'checked_in';
create index if not exists check_ins_context_idx on public.check_ins(context_type, context_id, status);

alter table public.check_ins enable row level security;

create policy "check ins owner full access" on public.check_ins
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- The event host may read attendance for their own event.
create policy "check ins readable by event host" on public.check_ins
  for select using (
    context_type = 'event'
    and exists (
      select 1 from public.events e
      where e.id = check_ins.context_id and e.host_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- FEATURE 4: Temporary Event Circles — short-lived groups around an event.
-- ---------------------------------------------------------------------------

create table if not exists public.event_circles (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references public.events(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  description text check (char_length(description) <= 500),
  join_mode text not null default 'invite' check (
    join_mode in ('invite', 'check_in', 'qr', 'community')
  ),
  status text not null default 'open' check (
    status in ('draft', 'open', 'active', 'closing', 'archived', 'deleted')
  ),
  member_visibility text not null default 'members' check (
    member_visibility in ('members', 'count_only', 'host_only')
  ),
  opens_at timestamptz,
  closes_at timestamptz,
  archives_at timestamptz,
  max_members integer not null default 50 check (max_members between 1 and 5000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.event_circle_members (
  id uuid primary key default gen_random_uuid(),
  event_circle_id uuid not null references public.event_circles(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('host', 'co_host', 'moderator', 'member')),
  -- 'banned' is terminal for rejoining (spec §57, §59).
  status text not null default 'joined' check (status in ('joined', 'left', 'removed', 'banned')),
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  created_at timestamptz not null default now(),
  constraint event_circle_members_unique unique (event_circle_id, user_id)
);

create table if not exists public.event_announcements (
  id uuid primary key default gen_random_uuid(),
  event_circle_id uuid not null references public.event_circles(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  body text not null check (char_length(body) between 1 and 1000),
  priority text not null default 'normal' check (priority in ('normal', 'high')),
  published_at timestamptz not null default now(),
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists event_circles_event_idx on public.event_circles(event_id);
create index if not exists event_circles_owner_status_idx on public.event_circles(owner_id, status);
create index if not exists event_circles_archive_idx on public.event_circles(status, archives_at);
create index if not exists event_circle_members_user_idx on public.event_circle_members(user_id, status);
create index if not exists event_circle_members_circle_idx on public.event_circle_members(event_circle_id, status);
create index if not exists event_announcements_circle_idx
  on public.event_announcements(event_circle_id, published_at desc);

alter table public.event_circles enable row level security;
alter table public.event_circle_members enable row level security;
alter table public.event_announcements enable row level security;

create policy "event circles owner full access" on public.event_circles
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- A circle is readable by its joined members; discovery/join eligibility is
-- enforced in the application layer.
create policy "event circles visible to members" on public.event_circles
  for select using (
    exists (
      select 1 from public.event_circle_members m
      where m.event_circle_id = event_circles.id
        and m.user_id = auth.uid()
        and m.status = 'joined'
    )
  );

create policy "event circle members visible to members" on public.event_circle_members
  for select using (
    auth.uid() = user_id
    or exists (
      select 1 from public.event_circles c
      where c.id = event_circle_members.event_circle_id and c.owner_id = auth.uid()
    )
  );

create policy "event announcements visible to members" on public.event_announcements
  for select using (
    exists (
      select 1 from public.event_circle_members m
      where m.event_circle_id = event_announcements.event_circle_id
        and m.user_id = auth.uid()
        and m.status = 'joined'
    )
  );
