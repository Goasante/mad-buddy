-- Global maintenance mode. A single row (id is forced to true) holds whether
-- the app is paused for every non-staff user, plus the message shown on the
-- maintenance screen.
--
-- Deliberately its own table rather than a new emergency_controls key: those
-- are per-feature kill switches that leave the rest of the app usable, while
-- this pauses everything and needs its own operator-facing message.
create table if not exists public.maintenance_mode (
  id boolean primary key default true check (id),
  is_active boolean not null default false,
  message text check (char_length(message) <= 500),
  activated_by uuid references auth.users(id) on delete set null,
  activated_at timestamptz,
  updated_at timestamptz not null default now()
);

insert into public.maintenance_mode (id, is_active)
values (true, false)
on conflict (id) do nothing;

-- Readable by anyone (including signed-out visitors) so the app can show the
-- maintenance screen; only the service role may flip it, which is how the
-- admin action runs.
alter table public.maintenance_mode enable row level security;

drop policy if exists "maintenance mode readable" on public.maintenance_mode;
create policy "maintenance mode readable" on public.maintenance_mode
  for select using (true);
