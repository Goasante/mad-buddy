-- Plans, RSVP, Plan Polls, and Hangout Mode (feature architecture batch 3).
-- Additive only: new tables, indexes, and RLS policies. Nothing is dropped or
-- altered. The batch-1 temporary_plans table (lightweight ping→plan) is left
-- untouched; these richer `plans` tables coexist with it. Safe to apply before
-- the corresponding application deploy — deployed code does not reference these
-- tables until the next release.
--
-- Rollback: drop the tables below (nothing existing depends on them):
--   drop table if exists public.hangout_requests, public.hangout_audience_targets,
--     public.hangout_sessions, public.plan_poll_votes, public.plan_poll_options,
--     public.plan_polls, public.plan_participants, public.plans cascade;

-- ---------------------------------------------------------------------------
-- FEATURE 1: Plans — structured invitations. MVP: scheduled + quick + poll.
-- Place is custom text for MVP (spec §9, §63); place_id reserved for later.
-- ---------------------------------------------------------------------------

create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 80),
  description text check (char_length(description) <= 500),
  plan_type text not null check (plan_type in ('quick', 'scheduled', 'poll')),
  visibility_type text not null default 'invited' check (
    visibility_type in ('invited', 'circle', 'close_friends')
  ),
  status text not null default 'inviting' check (
    status in ('draft', 'inviting', 'polling', 'confirmed', 'cancelled', 'completed', 'expired')
  ),
  start_at timestamptz,
  end_at timestamptz,
  timezone text not null default 'UTC',
  rsvp_deadline timestamptz,
  max_participants integer not null default 10 check (max_participants between 1 and 500),
  place_type text not null default 'custom' check (
    place_type in ('custom', 'decide_in_chat', 'poll')
  ),
  place_id uuid,
  custom_place_text text check (char_length(custom_place_text) <= 120),
  reminder_minutes integer check (reminder_minutes between 0 and 1440),
  source_hangout_id uuid,
  source_ping_id uuid references public.meeting_pings(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  cancelled_at timestamptz,
  completed_at timestamptz,
  -- A scheduled plan must carry a start; quick/poll plans may defer it.
  constraint plans_scheduled_needs_start check (
    plan_type <> 'scheduled' or start_at is not null
  ),
  constraint plans_end_after_start check (end_at is null or start_at is null or end_at >= start_at)
);

create table if not exists public.plan_participants (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'participant' check (role in ('host', 'co_host', 'participant')),
  rsvp_status text not null default 'invited' check (
    rsvp_status in ('invited', 'viewed', 'going', 'maybe', 'not_going', 'removed', 'waitlisted')
  ),
  response_note text check (char_length(response_note) <= 200),
  attendance_visibility text not null default 'names' check (
    attendance_visibility in ('names', 'counts', 'host_only')
  ),
  invited_by uuid references auth.users(id) on delete set null,
  viewed_at timestamptz,
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint plan_participants_unique unique (plan_id, user_id)
);

create index if not exists plans_creator_status_idx on public.plans(creator_id, status);
create index if not exists plans_start_idx on public.plans(start_at);
create index if not exists plan_participants_user_idx on public.plan_participants(user_id, rsvp_status);
create index if not exists plan_participants_plan_idx on public.plan_participants(plan_id);

alter table public.plans enable row level security;
alter table public.plan_participants enable row level security;

-- A plan is visible to its creator and to anyone invited (a participant row).
-- Non-participants never see the plan. Fine-grained edit rights are enforced in
-- the application layer (service role); these policies are the floor.
create policy "plans visible to participants" on public.plans
  for select using (
    auth.uid() = creator_id
    or exists (
      select 1 from public.plan_participants p
      where p.plan_id = plans.id and p.user_id = auth.uid()
        and p.rsvp_status <> 'removed'
    )
  );

create policy "plans editable by creator" on public.plans
  for update using (auth.uid() = creator_id) with check (auth.uid() = creator_id);

create policy "participants visible to plan members" on public.plan_participants
  for select using (
    auth.uid() = user_id
    or exists (
      select 1 from public.plans pl
      where pl.id = plan_participants.plan_id and pl.creator_id = auth.uid()
    )
  );

-- A participant may update only their own row (their RSVP).
create policy "participants update own rsvp" on public.plan_participants
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- FEATURE 3: Plan Polls — time and place polls. Manual winner confirmation.
-- ---------------------------------------------------------------------------

create table if not exists public.plan_polls (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans(id) on delete cascade,
  creator_id uuid not null references auth.users(id) on delete cascade,
  poll_type text not null check (poll_type in ('time', 'date', 'place', 'activity')),
  question text not null check (char_length(question) between 1 and 160),
  selection_mode text not null default 'single' check (selection_mode in ('single', 'multiple')),
  results_visibility text not null default 'immediate' check (
    results_visibility in ('immediate', 'after_vote', 'after_close', 'host_only')
  ),
  closes_at timestamptz,
  status text not null default 'open' check (status in ('open', 'closed', 'confirmed')),
  confirmed_option_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.plan_poll_options (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.plan_polls(id) on delete cascade,
  label text not null check (char_length(label) between 1 and 120),
  value text check (char_length(value) <= 120),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.plan_poll_votes (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.plan_polls(id) on delete cascade,
  option_id uuid not null references public.plan_poll_options(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  -- One vote per (poll, option, user); single-choice is additionally enforced
  -- in the application layer by clearing prior votes before inserting.
  constraint plan_poll_votes_unique unique (poll_id, option_id, user_id)
);

create index if not exists plan_polls_plan_idx on public.plan_polls(plan_id);
create index if not exists plan_poll_options_poll_idx on public.plan_poll_options(poll_id, sort_order);
create index if not exists plan_poll_votes_poll_idx on public.plan_poll_votes(poll_id);

alter table public.plan_polls enable row level security;
alter table public.plan_poll_options enable row level security;
alter table public.plan_poll_votes enable row level security;

-- Polls, options, and votes are readable by anyone who can see the plan.
create policy "polls visible to plan members" on public.plan_polls
  for select using (
    exists (
      select 1 from public.plans pl
      where pl.id = plan_polls.plan_id
        and (
          pl.creator_id = auth.uid()
          or exists (
            select 1 from public.plan_participants pp
            where pp.plan_id = pl.id and pp.user_id = auth.uid() and pp.rsvp_status <> 'removed'
          )
        )
    )
  );

create policy "poll options visible to plan members" on public.plan_poll_options
  for select using (
    exists (
      select 1 from public.plan_polls pk
      join public.plans pl on pl.id = pk.plan_id
      where pk.id = plan_poll_options.poll_id
        and (
          pl.creator_id = auth.uid()
          or exists (
            select 1 from public.plan_participants pp
            where pp.plan_id = pl.id and pp.user_id = auth.uid() and pp.rsvp_status <> 'removed'
          )
        )
    )
  );

create policy "poll votes readable by plan members" on public.plan_poll_votes
  for select using (
    exists (
      select 1 from public.plan_polls pk
      join public.plans pl on pl.id = pk.plan_id
      where pk.id = plan_poll_votes.poll_id
        and (
          pl.creator_id = auth.uid()
          or exists (
            select 1 from public.plan_participants pp
            where pp.plan_id = pl.id and pp.user_id = auth.uid() and pp.rsvp_status <> 'removed'
          )
        )
    )
  );

create policy "poll votes owned by voter" on public.plan_poll_votes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- FEATURE 4: Hangout Mode — "open to do something" temporary sessions.
-- ---------------------------------------------------------------------------

create table if not exists public.hangout_sessions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  activity_type text not null check (
    activity_type in ('food', 'study', 'sports', 'gym', 'walk', 'gaming', 'chill', 'anything')
  ),
  message text check (char_length(message) <= 140),
  audience_type text not null default 'all_muddies' check (
    audience_type in ('all_muddies', 'close_friends', 'selected_circles', 'selected_muddies')
  ),
  broad_area_text text check (char_length(broad_area_text) <= 80),
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  max_participants integer not null default 5 check (max_participants between 1 and 50),
  allow_pings boolean not null default true,
  allow_friend_invites boolean not null default false,
  status text not null default 'active' check (
    status in ('draft', 'active', 'paused', 'full', 'expired', 'cancelled', 'converted_to_plan')
  ),
  converted_plan_id uuid references public.plans(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hangout_ends_after_start check (ends_at > starts_at)
);

create table if not exists public.hangout_audience_targets (
  id uuid primary key default gen_random_uuid(),
  hangout_session_id uuid not null references public.hangout_sessions(id) on delete cascade,
  target_type text not null check (target_type in ('circle', 'user')),
  target_id uuid not null,
  created_at timestamptz not null default now(),
  constraint hangout_targets_unique unique (hangout_session_id, target_type, target_id)
);

create table if not exists public.hangout_requests (
  id uuid primary key default gen_random_uuid(),
  hangout_session_id uuid not null references public.hangout_sessions(id) on delete cascade,
  requester_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (
    status in ('pending', 'accepted', 'maybe', 'declined', 'cancelled')
  ),
  message text check (char_length(message) <= 140),
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  -- One live request per (session, requester); re-requesting updates in place.
  constraint hangout_requests_unique unique (hangout_session_id, requester_id)
);

create index if not exists hangout_sessions_owner_status_idx on public.hangout_sessions(owner_id, status);
create index if not exists hangout_sessions_active_idx on public.hangout_sessions(status, ends_at);
create index if not exists hangout_targets_session_idx on public.hangout_audience_targets(hangout_session_id);
create index if not exists hangout_requests_session_idx on public.hangout_requests(hangout_session_id, status);
create index if not exists hangout_requests_requester_idx on public.hangout_requests(requester_id);

alter table public.hangout_sessions enable row level security;
alter table public.hangout_audience_targets enable row level security;
alter table public.hangout_requests enable row level security;

-- Owner has full control of their session. Muddies may read an active session;
-- audience narrowing (circles/close friends/exclusions) and Ghost Mode are
-- enforced in the application layer (service role). This policy is the floor.
create policy "hangout owner full access" on public.hangout_sessions
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create policy "muddies read active hangouts" on public.hangout_sessions
  for select using (
    status = 'active'
    and ends_at > now()
    and exists (
      select 1 from public.friendships f
      where (f.user_one_id = auth.uid() and f.user_two_id = hangout_sessions.owner_id)
         or (f.user_two_id = auth.uid() and f.user_one_id = hangout_sessions.owner_id)
    )
  );

create policy "hangout targets owner access" on public.hangout_audience_targets
  for all using (
    exists (
      select 1 from public.hangout_sessions s
      where s.id = hangout_audience_targets.hangout_session_id and s.owner_id = auth.uid()
    )
  );

-- A join request is visible to the requester and the session owner.
create policy "hangout requests visible to owner and requester" on public.hangout_requests
  for select using (
    auth.uid() = requester_id
    or exists (
      select 1 from public.hangout_sessions s
      where s.id = hangout_requests.hangout_session_id and s.owner_id = auth.uid()
    )
  );

create policy "hangout requests created by requester" on public.hangout_requests
  for insert with check (auth.uid() = requester_id);
