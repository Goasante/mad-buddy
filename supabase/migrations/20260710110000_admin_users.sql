-- Database-backed admin allowlist.
-- Passwords are never stored here; Supabase Auth owns credentials.

create table if not exists public.admin_users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  auth_user_id uuid unique references auth.users(id) on delete set null,
  role text not null default 'admin',
  invited_by_user_id uuid references auth.users(id) on delete set null,
  disabled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint admin_users_email_format check (email = lower(email) and email like '%@%'),
  constraint admin_users_role_check check (role in ('owner', 'admin', 'support'))
);

create index if not exists admin_users_email_active_idx
  on public.admin_users(email)
  where disabled_at is null;

drop trigger if exists admin_users_set_updated_at on public.admin_users;
create trigger admin_users_set_updated_at
  before update on public.admin_users
  for each row
  execute function public.set_updated_at();

alter table public.admin_users enable row level security;
