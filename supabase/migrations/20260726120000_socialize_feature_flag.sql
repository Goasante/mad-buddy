-- Record the latest actor directly for fast owner-facing status display. The
-- append-only admin audit log remains the complete history/source of truth.
alter table public.feature_flags
  add column if not exists updated_by uuid references auth.users(id) on delete set null;

-- Socialize already exists, so preserve today's behaviour when this is applied.
-- Staff may subsequently pause it from the audited Feature controls screen.
insert into public.feature_flags (key, description, status, default_value)
values (
  'socialize',
  'Lets members opt in briefly to discover other nearby people who are also open to connecting.',
  'on',
  true
)
on conflict (key) do nothing;
