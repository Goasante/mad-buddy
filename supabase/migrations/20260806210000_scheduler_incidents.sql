-- Scheduler incident state.
--
-- Why a table rather than memory: the alert rule is "one notification per
-- incident", and the process that detects an incident is a serverless
-- function that does not survive between ticks. In-memory state would send a
-- fresh alert on every tick during an outage, and would forget an open
-- incident across a deployment — so a recovery could arrive with no matching
-- alert, or an alert could repeat every five minutes.
--
-- Exactly one row is ever open (opened_at set, resolved_at null). Enforced by
-- a partial unique index rather than by application discipline, so two
-- concurrent ticks cannot both open an incident.
--
-- Contains NO private data: counts, timestamps and a short state string. No
-- job payloads, no user content, no secrets.
--
-- Rollback:
--   drop table if exists public.scheduler_incidents;

create table if not exists public.scheduler_incidents (
  id uuid primary key default gen_random_uuid(),
  -- Which scheduler this incident concerns, so a future second scheduler can
  -- have its own incident stream without colliding.
  scheduler text not null default 'cron-tick-5min' check (char_length(scheduler) <= 64),
  opened_at timestamptz not null default now(),
  resolved_at timestamptz,
  -- Snapshot of what triggered it. Counts only.
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  missing_ticks boolean not null default false,
  -- Set once the Owner alert is delivered, so a retry cannot double-send.
  alerted_at timestamptz,
  -- Set once the recovery notice is delivered, for the same reason.
  recovery_notified_at timestamptz,
  created_at timestamptz not null default now()
);

-- At most one OPEN incident per scheduler. This is what makes "one alert per
-- incident" true under concurrency rather than merely intended.
create unique index if not exists scheduler_incidents_one_open
  on public.scheduler_incidents(scheduler)
  where resolved_at is null;

create index if not exists scheduler_incidents_recent_idx
  on public.scheduler_incidents(scheduler, opened_at desc);

-- Operational data, service role only. No user ever reads or writes this.
alter table public.scheduler_incidents enable row level security;
revoke all on table public.scheduler_incidents from public, anon, authenticated;
grant select, insert, update on table public.scheduler_incidents to service_role;
