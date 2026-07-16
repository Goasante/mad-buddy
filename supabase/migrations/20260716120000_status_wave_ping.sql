-- Muddy Status, Wave, and Meeting Ping (feature architecture batch 1).
-- Additive only: creates new tables, indexes, and RLS policies. Nothing is
-- dropped or altered. The legacy meetup_requests table is intentionally left
-- untouched. Safe to apply before the corresponding application deploy —
-- deployed code does not reference these tables until the next release.
--
-- Rollback: drop the seven tables below (no existing table depends on them):
--   drop table if exists public.temporary_plans,
--     public.meeting_ping_responses, public.meeting_pings,
--     public.wave_mutes, public.waves,
--     public.status_visibility_targets, public.user_statuses cascade;

-- ---------------------------------------------------------------------------
-- FEATURE 1: Muddy Status — one active status per user, always with expiry.
-- ---------------------------------------------------------------------------

create table if not exists public.user_statuses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  availability_type text not null check (
    availability_type in ('free', 'open_to_hang_out', 'maybe_available', 'busy', 'do_not_disturb')
  ),
  activity_type text check (
    activity_type in (
      'studying', 'working', 'eating', 'at_an_event', 'exercising',
      'gaming', 'travelling', 'heading_home', 'relaxing'
    )
  ),
  custom_text text check (char_length(custom_text) <= 60),
  visibility_type text not null default 'all_muddies' check (
    visibility_type in ('all_muddies', 'selected_circles', 'selected_muddies')
  ),
  starts_at timestamptz not null default now(),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_statuses_expiry_after_start check (expires_at > starts_at)
);

create table if not exists public.status_visibility_targets (
  id uuid primary key default gen_random_uuid(),
  status_id uuid not null references public.user_statuses(id) on delete cascade,
  target_type text not null check (target_type in ('circle', 'user')),
  target_id uuid not null,
  created_at timestamptz not null default now(),
  constraint status_targets_unique unique (status_id, target_type, target_id)
);

create index if not exists user_statuses_expires_idx on public.user_statuses(expires_at);
create index if not exists status_targets_status_idx on public.status_visibility_targets(status_id);

alter table public.user_statuses enable row level security;
alter table public.status_visibility_targets enable row level security;

create policy "statuses owner full access" on public.user_statuses
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Muddies may read an unexpired status; per-circle/per-user narrowing is
-- enforced in the application layer (service role), this policy is the floor.
create policy "muddies read unexpired statuses" on public.user_statuses
  for select using (
    expires_at > now()
    and exists (
      select 1 from public.friendships f
      where (f.user_one_id = auth.uid() and f.user_two_id = user_statuses.user_id)
         or (f.user_two_id = auth.uid() and f.user_one_id = user_statuses.user_id)
    )
  );

create policy "status targets owner access" on public.status_visibility_targets
  for all using (
    exists (
      select 1 from public.user_statuses s
      where s.id = status_visibility_targets.status_id and s.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- FEATURE 2: Wave — lightweight acknowledgement with cooldowns and mutes.
-- ---------------------------------------------------------------------------

create table if not exists public.waves (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  source text not null default 'proximity_card' check (
    source in ('proximity_card', 'profile', 'chat', 'status', 'wave_back')
  ),
  reply_to_wave_id uuid references public.waves(id) on delete set null,
  sent_at timestamptz not null default now(),
  seen_at timestamptz,
  responded_at timestamptz,
  response_type text check (response_type in ('wave_back', 'message', 'meeting_ping', 'none')),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  created_at timestamptz not null default now(),
  constraint waves_not_self check (sender_id <> recipient_id)
);

create table if not exists public.wave_mutes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  muted_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint wave_mutes_unique unique (user_id, muted_user_id),
  constraint wave_mutes_not_self check (user_id <> muted_user_id)
);

create index if not exists waves_recipient_sent_idx on public.waves(recipient_id, sent_at desc);
create index if not exists waves_pair_cooldown_idx on public.waves(sender_id, recipient_id, sent_at desc);

alter table public.waves enable row level security;
alter table public.wave_mutes enable row level security;

create policy "waves visible to participants" on public.waves
  for select using (auth.uid() in (sender_id, recipient_id));

create policy "waves recipient can mark seen" on public.waves
  for update using (auth.uid() = recipient_id) with check (auth.uid() = recipient_id);

create policy "wave mutes owner access" on public.wave_mutes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- FEATURE 3: Meeting Ping — structured "want to meet?" with a state machine.
-- meetup_requests remains for legacy prompts; new flows use these tables.
-- ---------------------------------------------------------------------------

create table if not exists public.meeting_pings (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  ping_type text not null check (
    ping_type in ('meet', 'food', 'study', 'chat', 'walk', 'custom')
  ),
  custom_message text check (char_length(custom_message) <= 180),
  proposed_time timestamptz not null,
  expires_at timestamptz not null,
  place_type text not null default 'chat' check (place_type in ('custom', 'chat')),
  custom_place_text text check (char_length(custom_place_text) <= 80),
  status text not null default 'pending' check (
    status in (
      'pending', 'seen', 'maybe', 'counter_proposed',
      'accepted', 'declined', 'cancelled', 'expired', 'completed'
    )
  ),
  seen_at timestamptz,
  responded_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint meeting_pings_not_self check (sender_id <> recipient_id)
);

create table if not exists public.meeting_ping_responses (
  id uuid primary key default gen_random_uuid(),
  ping_id uuid not null references public.meeting_pings(id) on delete cascade,
  responder_id uuid not null references auth.users(id) on delete cascade,
  response_type text not null check (
    response_type in ('accept', 'maybe', 'decline', 'counter_propose', 'message')
  ),
  suggested_time timestamptz,
  message text check (char_length(message) <= 180),
  created_at timestamptz not null default now()
);

create table if not exists public.temporary_plans (
  id uuid primary key default gen_random_uuid(),
  -- Unique: the accept flow can never create two plans for one ping, even
  -- under concurrent duplicate requests (spec §45 race condition).
  source_ping_id uuid not null unique references public.meeting_pings(id) on delete cascade,
  creator_id uuid not null references auth.users(id) on delete cascade,
  participant_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) <= 80),
  meeting_time timestamptz not null,
  place_text text check (char_length(place_text) <= 80),
  status text not null default 'active' check (status in ('active', 'cancelled', 'completed')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists meeting_pings_recipient_status_idx on public.meeting_pings(recipient_id, status);
create index if not exists meeting_pings_sender_status_idx on public.meeting_pings(sender_id, status);
create index if not exists temporary_plans_participants_idx on public.temporary_plans(creator_id, participant_id);

alter table public.meeting_pings enable row level security;
alter table public.meeting_ping_responses enable row level security;
alter table public.temporary_plans enable row level security;

create policy "pings visible to participants" on public.meeting_pings
  for select using (auth.uid() in (sender_id, recipient_id));

create policy "ping responses visible to participants" on public.meeting_ping_responses
  for select using (
    exists (
      select 1 from public.meeting_pings p
      where p.id = meeting_ping_responses.ping_id
        and auth.uid() in (p.sender_id, p.recipient_id)
    )
  );

create policy "plans visible to participants" on public.temporary_plans
  for select using (auth.uid() in (creator_id, participant_id));
