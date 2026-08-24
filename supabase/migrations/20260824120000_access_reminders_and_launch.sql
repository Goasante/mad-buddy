-- Reminder dedupe, and the existing-user launch mechanism.

-- ---------------------------------------------------------------------------
-- 1. Reminder log — the dedupe that makes the job safe to run twice.
-- ---------------------------------------------------------------------------
-- The unique constraint IS the idempotency. Overlapping cron runs, a retry
-- after a partial failure, or a job scheduled twice by mistake all collide here
-- rather than producing two identical notifications.
--
-- The job claims a row BEFORE sending, so the worst case is a missed reminder
-- instead of a duplicate one. That is the right way round: a person who misses
-- a reminder still sees the countdown in Settings and the locked state when it
-- happens, whereas a duplicate is pure irritation about a free trial they never
-- paid for.
create table if not exists public.access_reminder_log (
  id uuid primary key default gen_random_uuid(),
  grant_id uuid not null references public.access_grants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  milestone text not null check (milestone in ('welcome_t4', 'welcome_t1')),
  sent_at timestamptz not null default now(),

  -- One notification per grant per milestone, forever.
  constraint access_reminder_log_once unique (grant_id, milestone)
);

create index if not exists access_reminder_log_user_idx
  on public.access_reminder_log (user_id, sent_at desc);

comment on table public.access_reminder_log is
  'Dedupe ledger for Welcome Access reminders. UNIQUE (grant_id, milestone) makes the reminder job safe under retries and overlapping runs.';

alter table public.access_reminder_log enable row level security;

-- Readable by the person it concerns; never writable by them. As with
-- access_grants, the absence of INSERT/UPDATE/DELETE policies is the control:
-- with RLS on and no permissive policy, those commands are denied outright.
drop policy if exists "reminder log visible to the owner" on public.access_reminder_log;
create policy "reminder log visible to the owner" on public.access_reminder_log
  for select using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 2. Existing users at launch.
-- ---------------------------------------------------------------------------
-- THE PROBLEM, stated exactly.
--
-- Welcome Access starts at `first_muddy_added` and runs 14 days. Thousands of
-- existing accounts reached that milestone months ago. Two obvious readings are
-- both wrong:
--
--   "their window already elapsed"  -- every existing user is expired the
--                                      instant monetization ships, having never
--                                      seen the model, never been told, and
--                                      never had a chance to use what they are
--                                      about to lose. Punitive and indefensible.
--
--   "restart everyone's clock"      -- silently re-grants access to accounts
--                                      that may have been dormant for a year,
--                                      and does it again on every deploy if the
--                                      backfill is not idempotent.
--
-- THE MECHANISM, which is a product decision the OWNER makes, not a date this
-- migration invents.
--
-- `access_launch` holds at most one row: the moment monetization becomes real.
-- Until a row exists, `launch_welcome_access_for_existing_users()` does
-- nothing, so this migration is inert on application. When the owner sets the
-- launch, the function grants every eligible existing account a fresh 14-day
-- Welcome Access window dated from LAUNCH, not from their original milestone.
--
-- Why that is the fair reading: the 14 days exist so somebody can experience
-- Linkr and UpFor before deciding. An account that reached its first Muddy
-- before the model existed has not had that chance yet, so the window starts
-- when the offer starts. It is the same 14 days everybody else gets.
--
-- ELIGIBILITY is "has a Muddy" -- the same condition the trigger uses, applied
-- retroactively. Accounts with no Muddy get nothing now and start their window
-- naturally when they make one, exactly like a new signup.
create table if not exists public.access_launch (
  id boolean primary key default true,
  launched_at timestamptz not null,
  welcome_days integer not null default 14,
  note text,
  created_at timestamptz not null default now(),

  -- Exactly one row, ever. `id` is a boolean pinned to true, so a second insert
  -- collides on the primary key rather than creating a second launch.
  constraint access_launch_singleton check (id = true),
  constraint access_launch_days_sane check (welcome_days between 1 and 365)
);

comment on table public.access_launch is
  'At most one row: when Mad Buddy Access monetization went live. Until it exists, the existing-user backfill is a no-op. The date is an owner decision, never inferred.';

alter table public.access_launch enable row level security;
-- No policy at all: this is operator configuration, readable only by the
-- service role. Nothing in the product UI needs it.

-- The backfill, callable and idempotent.
--
-- Safe to run repeatedly: `on conflict do nothing` against the one-welcome-per-
-- user index means a second run grants nothing new. Safe to run before launch:
-- it returns 0 while `access_launch` is empty.
create or replace function public.launch_welcome_access_for_existing_users()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_launch public.access_launch%rowtype;
  v_granted integer := 0;
begin
  select * into v_launch from public.access_launch limit 1;

  -- No launch recorded yet. This is the normal state until the owner decides.
  if not found then
    return 0;
  end if;

  with eligible as (
    select distinct u.user_id
    from (
      select user_one_id as user_id from public.friendships where ended_at is null
      union
      select user_two_id from public.friendships where ended_at is null
    ) u
  )
  insert into public.access_grants (user_id, source, starts_at, expires_at, reason)
  select
    e.user_id,
    'welcome_access',
    v_launch.launched_at,
    v_launch.launched_at + make_interval(days => v_launch.welcome_days),
    'Welcome Access granted at monetization launch for an existing account'
  from eligible e
  -- Anybody who already has a welcome grant keeps theirs untouched.
  on conflict (user_id) where source = 'welcome_access' do nothing;

  get diagnostics v_granted = row_count;
  return v_granted;
end;
$$;

revoke all on function public.launch_welcome_access_for_existing_users() from public, anon, authenticated;

comment on function public.launch_welcome_access_for_existing_users() is
  'Grants existing accounts with a Muddy a full Welcome Access window dated from launch. Idempotent and a no-op until a row exists in access_launch.';

-- ROLLBACK (for the production application order; not run here):
--   drop function if exists public.launch_welcome_access_for_existing_users();
--   drop table if exists public.access_launch;
--   drop table if exists public.access_reminder_log;
--
-- Dropping access_reminder_log loses the dedupe history, so reminders already
-- sent could be sent once more. Harmless but worth knowing before rolling back.
