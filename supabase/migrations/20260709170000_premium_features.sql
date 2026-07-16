create table public.best_buddies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  friend_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint best_buddies_not_self check (user_id <> friend_id),
  constraint best_buddies_unique_pair unique (user_id, friend_id)
);

create table public.event_modes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  visibility_rule text not null default 'friends_only',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint event_modes_valid_window check (starts_at < ends_at)
);

create index best_buddies_user_idx on public.best_buddies(user_id);
create index best_buddies_friend_idx on public.best_buddies(friend_id);
create index event_modes_user_window_idx on public.event_modes(user_id, starts_at, ends_at);

create trigger event_modes_set_updated_at before update on public.event_modes for each row execute function public.set_updated_at();

alter table public.best_buddies enable row level security;
alter table public.event_modes enable row level security;

create policy "best buddies owner access" on public.best_buddies
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "event modes owner access" on public.event_modes
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
