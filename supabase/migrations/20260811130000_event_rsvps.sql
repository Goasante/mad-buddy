-- Event RSVP / Going (Plans + Events lifecycle, Stage C).
--
-- WHAT THIS ADDS. Pre-event participation intent, separate from check-in.
-- Audited first: no event_rsvps, event_attendees or event_participants table
-- existed anywhere in the schema. event_circle_members is a different concept
-- entirely (membership in a sub-group within an event, with
-- host/co_host/moderator/member roles); it says nothing about whether someone
-- intends to attend the event itself. This is genuinely new, not a duplicate.
--
-- interested / going / not_going is stored, never deleted on decline: intent
-- is a fact about what the user decided, and Stage D needs "this user
-- explicitly said not_going" as a clean signal to suppress a reminder rather
-- than inferring it from a missing row.
--
-- HOST ATTENDANCE IS DELIBERATELY NOT A ROW HERE. Hosting and RSVPing are
-- different concepts (spec decision, Stage C): a host does not need to tell
-- themselves they are going to their own event. Agenda inclusion for a host
-- is derived from events.host_id at read time, in application code, not by
-- fabricating a row in this table.
--
-- UPDATED_AT reuses the existing public.set_updated_at() trigger
-- (20260709100000_initial_schema.sql), the same one profiles, friend_requests
-- and five other tables already use. No second timestamp convention.

create table if not exists public.event_rsvps (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null check (status in ('interested', 'going', 'not_going')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One user, one event, one row. Going -> Interested -> Not Going are all
  -- the SAME row changing status, never a new one -- this is what makes the
  -- upsert path idempotent and what stops "Going" tapped twice creating two
  -- rows for the unique index to fight over.
  constraint event_rsvps_unique unique (event_id, user_id)
);

create trigger event_rsvps_set_updated_at
  before update on public.event_rsvps
  for each row execute function public.set_updated_at();

-- (user_id, status): "which events is this user going to", the read the
-- personal agenda projection does for every Home load.
create index if not exists event_rsvps_user_status_idx on public.event_rsvps(user_id, status);
-- (event_id, status): "how many are going / interested", the read an event's
-- own detail page and any future aggregate-count RPC does.
create index if not exists event_rsvps_event_status_idx on public.event_rsvps(event_id, status);

alter table public.event_rsvps enable row level security;

-- Owner reads their own RSVP state only. NOT "anyone who can see the event
-- reads every RSVP row" -- that would hand out a full attendee list through
-- RLS as a side effect of a viewer wanting to know their own status.
-- Aggregate counts (going/interested) are a SEPARATE, narrower concern:
-- Stage C leaves them out rather than widening this policy to produce them,
-- per the explicit instruction not to broaden RLS merely for convenience.
create policy "event rsvps owner reads own" on public.event_rsvps
  for select using (auth.uid() = user_id);

-- Owner creates their own RSVP only. Cannot be forged as another user's,
-- and cannot be forged as the host silently RSVPing on someone else's behalf.
create policy "event rsvps owner creates own" on public.event_rsvps
  for insert with check (auth.uid() = user_id);

-- Owner updates their own RSVP only. Deliberately NO host override: a host
-- cannot rewrite an attendee's stated intent, per the explicit instruction
-- that RSVP hosts do not get arbitrary rewrite power over attendee state.
create policy "event rsvps owner updates own" on public.event_rsvps
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- No delete policy: not_going is stored, not removed. With RLS enabled and no
-- delete policy, delete is refused for every role but the service key, same
-- shape as blocked_users and friend_requests elsewhere in this schema.
