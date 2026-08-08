-- Make account deletion resumable.
--
-- Deletion spans three systems that cannot share a transaction: Postgres
-- tables, the storage bucket, and the Auth user registry. Something has to run
-- second, so the question is not whether this can be atomic (it cannot) but
-- what a half-finished deletion looks like.
--
-- Previously the answer was: bad. The Auth user was removed LAST, unguarded.
-- If that call failed, all sixteen tables had already been purged but the login
-- still worked -- and the user was told "your sign-in account could not be
-- removed", i.e. that deletion had failed, while their data was in fact gone.
-- Nothing recorded that they had ever asked, so nothing could resume it.
--
-- This table is the missing piece: a durable record of INTENT, written before
-- anything is destroyed. Every later step is idempotent, so a failed run can
-- simply be repeated from the recorded stage.
--
-- WHY NO FOREIGN KEY TO auth.users:
--   Deliberately absent, matching deletion_audit_logs. The final step of the
--   workflow deletes the auth user; a cascading FK would then delete this row
--   at the exact moment it is needed to confirm the workflow finished, and a
--   restricting FK would block the deletion outright. The row is cleaned up
--   explicitly on success instead.
--
-- WHY user_id IS UNIQUE:
--   One in-flight deletion per account. A repeated request -- a double tap, a
--   native client retrying after a dropped connection -- must re-assert the
--   same intent rather than start a second workflow.
--
-- Rollback:
--   drop table if exists public.account_deletion_requests;

create table if not exists public.account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  -- No FK, by design. See above.
  user_id uuid not null unique,
  -- How far the workflow got. A resumed run repeats from here; every step is
  -- idempotent, so repeating one that already succeeded is harmless.
  stage text not null default 'requested'
    check (stage in ('requested', 'reports_anonymised', 'data_purged', 'audited', 'auth_removed')),
  -- The user's own words, carried into the audit record on completion.
  reason text,
  requested_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Finds deletions that stalled, for a sweeper or an operator query. Partial:
-- a completed workflow deletes its row, so only unfinished work is indexed.
create index if not exists account_deletion_requests_stalled_idx
  on public.account_deletion_requests (requested_at)
  where stage <> 'auth_removed';

alter table public.account_deletion_requests enable row level security;

-- A user may see that their own deletion is in progress, and nothing else.
-- There is deliberately no INSERT, UPDATE or DELETE policy: the workflow runs
-- through the service role, so a client cannot mark itself deleted, cannot
-- advance its own stage past the work actually done, and cannot erase the
-- record that a deletion was requested.
create policy "deletion request owner reads"
  on public.account_deletion_requests
  for select
  using (auth.uid() = user_id);

comment on table public.account_deletion_requests is
  'In-flight account deletions. Written before any destructive step so a failure part-way through is resumable rather than leaving data destroyed and the login intact. Rows are removed on successful completion; a surviving row means the workflow stalled at its recorded stage.';

comment on column public.account_deletion_requests.stage is
  'Last COMPLETED step. Resume repeats from here; every step is idempotent, so repeating a finished one is a no-op.';
