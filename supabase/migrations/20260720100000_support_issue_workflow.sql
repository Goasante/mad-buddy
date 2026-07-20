-- Support and issues workflow (Admin slice).
--
-- Reuses the canonical public.support_tickets + public.support_ticket_messages
-- model. Public responses remain support_ticket_messages(sender_type='agent'),
-- readable by the ticket owner through the existing user-facing RLS. This
-- migration only ADDS two staff-only tables that the user-facing surface must
-- never see:
--
--   * support_internal_notes  — private staff notes, never delivered to users.
--   * support_ticket_events   — assignment/status/priority/reopen history.
--
-- Both have RLS enabled with NO user-facing policy, so authenticated end users
-- are denied by default and only the service-role admin client (used from
-- server-authorised actions) can read or write them. Additive only; no existing
-- table, column, or policy is changed.

-- ---------------------------------------------------------------------------
-- Internal notes (staff-only). Kept in a separate table from public responses
-- so an internal note can never be rendered in the user-facing conversation.
-- ---------------------------------------------------------------------------
create table if not exists public.support_internal_notes (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  author_id uuid references auth.users(id) on delete set null,
  body text not null check (char_length(trim(body)) between 1 and 5000),
  created_at timestamptz not null default now()
);

create index if not exists support_internal_notes_ticket_idx
  on public.support_internal_notes(ticket_id, created_at desc);

alter table public.support_internal_notes enable row level security;
-- No policy is defined on purpose: RLS-enabled with no policy denies every
-- non-service role. Internal notes are reachable only via the service-role
-- admin client behind a server-side admin.support.manage check.
revoke all on table public.support_internal_notes from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Ticket event history (staff-only): the assignment / status / priority /
-- reopen timeline shown in the issue detail view. The immutable admin audit
-- log remains the system of record; this table is the human-readable,
-- per-issue timeline that never leaves the Admin surface.
-- ---------------------------------------------------------------------------
create table if not exists public.support_ticket_events (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  event_type text not null check (
    event_type in (
      'status_changed', 'priority_changed', 'assigned', 'unassigned',
      'transferred', 'reopened', 'response_sent', 'note_added'
    )
  ),
  from_value text,
  to_value text,
  note text check (note is null or char_length(note) <= 500),
  created_at timestamptz not null default now()
);

create index if not exists support_ticket_events_ticket_idx
  on public.support_ticket_events(ticket_id, created_at desc);

alter table public.support_ticket_events enable row level security;
revoke all on table public.support_ticket_events from anon, authenticated;
