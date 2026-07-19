-- Production persistence for settings and user-submitted support content.
-- Additive only. No existing table or policy is replaced.

alter table public.user_preferences
  add column if not exists app_preferences jsonb not null default '{}'::jsonb;

create table if not exists public.app_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null check (category in ('feedback', 'suggestion')),
  rating smallint check (rating is null or rating between 1 and 5),
  message text not null default '' check (char_length(message) <= 500),
  status text not null default 'new' check (status in ('new', 'reviewing', 'resolved', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint feedback_has_content check (rating is not null or char_length(trim(message)) >= 3)
);

create index if not exists app_feedback_user_created_idx
  on public.app_feedback(user_id, created_at desc);

alter table public.app_feedback enable row level security;

create policy "feedback owner insert" on public.app_feedback
  for insert with check (auth.uid() = user_id);

create policy "feedback owner read" on public.app_feedback
  for select using (auth.uid() = user_id);

drop trigger if exists app_feedback_set_updated_at on public.app_feedback;
create trigger app_feedback_set_updated_at
  before update on public.app_feedback
  for each row execute function public.set_updated_at();

create table if not exists public.support_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  full_name text not null check (char_length(trim(full_name)) between 2 and 100),
  email text not null check (char_length(trim(email)) between 3 and 254),
  message text not null check (char_length(trim(message)) between 3 and 2000),
  status text not null default 'open' check (status in ('open', 'in_progress', 'resolved', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists support_requests_user_created_idx
  on public.support_requests(user_id, created_at desc);

alter table public.support_requests enable row level security;

create policy "support request owner insert" on public.support_requests
  for insert with check (auth.uid() = user_id);

create policy "support request owner read" on public.support_requests
  for select using (auth.uid() = user_id);

drop trigger if exists support_requests_set_updated_at on public.support_requests;
create trigger support_requests_set_updated_at
  before update on public.support_requests
  for each row execute function public.set_updated_at();
