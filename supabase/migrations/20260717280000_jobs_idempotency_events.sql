-- Background jobs, idempotency, domain events (feature architecture batch 14).
-- Additive only.
--
-- Why this exists: batches 5-13 produced six pieces of logic that are written
-- and tested but that NOTHING invokes — the Safe Arrival unconfirmed alert,
-- EXIF stripping, media deletion, scheduled downgrades, recap generation, and
-- streak closing. They are not missing UI; they are missing a runner. This
-- migration adds the queue those jobs run on (spec §26-§31).
--
-- Rollback:
--   drop table if exists public.domain_events, public.idempotency_keys,
--     public.jobs cascade;

-- ---------------------------------------------------------------------------
-- Batch 8 added friend_requests.expires_at but no terminal state to sweep them
-- into. Add one. 'declined' would be wrong — it would read to the sender as
-- though the recipient rejected them, when in fact nobody did anything.
-- Additive enum extension, same pattern as the Paystack migration.
-- ---------------------------------------------------------------------------

alter type public.friend_request_status add value if not exists 'expired';

-- ---------------------------------------------------------------------------
-- Job queue (spec §27, §28, §30).
-- ---------------------------------------------------------------------------

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  job_type text not null check (char_length(job_type) <= 64),
  payload jsonb not null default '{}'::jsonb,
  priority integer not null default 5 check (priority between 1 and 9),
  status text not null default 'queued' check (
    status in ('queued', 'scheduled', 'processing', 'completed', 'failed', 'retrying', 'dead_letter')
  ),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 5 check (max_attempts between 1 and 20),
  run_at timestamptz not null default now(),
  -- Set when a worker claims the job; used to reclaim jobs from a crashed run.
  locked_at timestamptz,
  locked_by text,
  last_error_code text check (char_length(last_error_code) <= 80),
  last_error_at timestamptz,
  -- Repeated enqueues of the same logical work collapse to one row (spec §32).
  idempotency_key text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create unique index if not exists jobs_idempotency_unique
  on public.jobs(idempotency_key)
  where idempotency_key is not null;

-- The claim query's index: due, runnable work in priority order.
create index if not exists jobs_runnable_idx
  on public.jobs(status, run_at, priority)
  where status in ('queued', 'scheduled', 'retrying');

create index if not exists jobs_dead_letter_idx on public.jobs(status) where status = 'dead_letter';
create index if not exists jobs_stuck_idx on public.jobs(status, locked_at) where status = 'processing';

alter table public.jobs enable row level security;
-- Staff/service-role only: no end-user policy. A job payload may reference
-- anything, so nobody but the worker reads this table.

-- ---------------------------------------------------------------------------
-- Idempotency keys (spec §32).
-- ---------------------------------------------------------------------------

create table if not exists public.idempotency_keys (
  id uuid primary key default gen_random_uuid(),
  -- Scoped per user so one client's key can't collide with another's.
  user_id uuid references auth.users(id) on delete cascade,
  scope text not null check (char_length(scope) <= 64),
  key text not null check (char_length(key) <= 128),
  -- The original result, replayed verbatim on a repeat request.
  result jsonb,
  status text not null default 'in_progress' check (status in ('in_progress', 'completed', 'failed')),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint idempotency_keys_unique unique (scope, key, user_id)
);

create index if not exists idempotency_keys_expiry_idx on public.idempotency_keys(expires_at);

alter table public.idempotency_keys enable row level security;
-- Service-role only.

-- ---------------------------------------------------------------------------
-- Domain events (spec §82) — versioned, append-only.
-- ---------------------------------------------------------------------------

create table if not exists public.domain_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (char_length(event_type) <= 64),
  version integer not null default 1 check (version >= 1),
  resource_type text not null check (char_length(resource_type) <= 40),
  resource_id uuid,
  actor_id uuid references auth.users(id) on delete set null,
  -- Safe payload only. Never message text, coordinates, or credentials.
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists domain_events_resource_idx on public.domain_events(resource_type, resource_id, occurred_at desc);
create index if not exists domain_events_type_idx on public.domain_events(event_type, occurred_at desc);

alter table public.domain_events enable row level security;
-- Service-role only.

-- Domain events are a historical record: rewriting one would corrupt any
-- consumer that has already read it.
create or replace function public.prevent_domain_event_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Domain events are append-only and cannot be modified or deleted.';
end;
$$;

drop trigger if exists domain_events_immutable on public.domain_events;
create trigger domain_events_immutable
  before update or delete on public.domain_events
  for each row execute function public.prevent_domain_event_mutation();

-- ---------------------------------------------------------------------------
-- Atomic job claim (spec §27). SKIP LOCKED means two concurrent workers can
-- never claim the same job, so a cron overlap can't double-send a Safe Arrival
-- alert or double-charge anything.
-- ---------------------------------------------------------------------------

create or replace function public.claim_jobs(p_worker text, p_limit integer, p_stale_seconds integer default 300)
returns setof public.jobs
language plpgsql
as $$
begin
  return query
  update public.jobs j
  set status = 'processing',
      locked_at = now(),
      locked_by = p_worker,
      attempts = j.attempts + 1
  where j.id in (
    select id from public.jobs
    where (
      (status in ('queued', 'scheduled', 'retrying') and run_at <= now())
      -- Reclaim work orphaned by a crashed worker.
      or (status = 'processing' and locked_at < now() - make_interval(secs => p_stale_seconds))
    )
    order by priority asc, run_at asc
    limit p_limit
    for update skip locked
  )
  returning j.*;
end;
$$;
