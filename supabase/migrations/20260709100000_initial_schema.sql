-- Mad Buddy initial Supabase schema.
-- Privacy rule: never expose another user's raw location, GPS accuracy, distance, or coordinates.

create extension if not exists pgcrypto;

create type public.friend_request_status as enum ('pending', 'accepted', 'declined', 'cancelled', 'blocked');
create type public.visibility_status as enum ('visible', 'ghost', 'app_open_only');
create type public.location_confidence as enum ('high', 'medium', 'low');
create type public.proximity_level as enum ('very_close', 'nearby', 'around', 'far', 'hidden');
create type public.subscription_plan as enum ('free', 'buddy_plus', 'buddy_pro');
create type public.subscription_status as enum ('free', 'trialing', 'active', 'past_due', 'cancelled', 'expired');
create type public.report_status as enum ('open', 'reviewing', 'resolved', 'dismissed');
create type public.meetup_status as enum ('pending', 'accepted', 'declined', 'expired');

create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  full_name text not null,
  username text not null unique,
  bio text,
  avatar_url text,
  mood_status text,
  visibility_status public.visibility_status not null default 'visible',
  is_onboarded boolean not null default false,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_username_format check (username ~ '^[a-z0-9_]{3,24}$')
);

create table public.friend_requests (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references auth.users(id) on delete cascade,
  receiver_id uuid not null references auth.users(id) on delete cascade,
  status public.friend_request_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint friend_requests_not_self check (sender_id <> receiver_id)
);

create table public.friendships (
  id uuid primary key default gen_random_uuid(),
  user_one_id uuid not null references auth.users(id) on delete cascade,
  user_two_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint friendships_not_self check (user_one_id <> user_two_id),
  constraint friendships_ordered check (user_one_id < user_two_id),
  constraint friendships_unique_pair unique (user_one_id, user_two_id)
);

create table public.user_locations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  latitude double precision not null,
  longitude double precision not null,
  accuracy double precision not null,
  confidence public.location_confidence not null,
  last_updated timestamptz not null default now(),
  constraint user_locations_valid_latitude check (latitude between -90 and 90),
  constraint user_locations_valid_longitude check (longitude between -180 and 180),
  constraint user_locations_valid_accuracy check (accuracy >= 0 and accuracy <= 10000)
);

create table public.proximity_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  friend_id uuid not null references auth.users(id) on delete cascade,
  proximity_level public.proximity_level not null,
  glow_strength integer not null,
  confidence public.location_confidence not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint proximity_events_not_self check (user_id <> friend_id),
  constraint proximity_events_glow_range check (glow_strength between 0 and 100)
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null,
  title text not null,
  message text not null,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.blocked_users (
  id uuid primary key default gen_random_uuid(),
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint blocked_users_not_self check (blocker_id <> blocked_id),
  constraint blocked_users_unique_pair unique (blocker_id, blocked_id)
);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references auth.users(id) on delete set null,
  reported_user_id uuid references auth.users(id) on delete set null,
  reported_user_label text not null default 'Active User',
  reason text not null,
  description text,
  status public.report_status not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  plan public.subscription_plan not null default 'free',
  status public.subscription_status not null default 'free',
  current_period_start timestamptz,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.friend_circles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text,
  visibility_rule text not null default 'friends',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.circle_members (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references public.friend_circles(id) on delete cascade,
  friend_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint circle_members_unique unique (circle_id, friend_id)
);

create table public.privacy_zones (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  latitude double precision not null,
  longitude double precision not null,
  radius integer not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint privacy_zones_valid_latitude check (latitude between -90 and 90),
  constraint privacy_zones_valid_longitude check (longitude between -180 and 180),
  constraint privacy_zones_valid_radius check (radius between 25 and 5000)
);

create table public.meetup_requests (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references auth.users(id) on delete cascade,
  receiver_id uuid not null references auth.users(id) on delete cascade,
  message text,
  status public.meetup_status not null default 'pending',
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint meetup_requests_not_self check (sender_id <> receiver_id)
);

create table public.user_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  glow_theme text not null default 'default',
  mood_status text,
  ghost_mode_type text not null default 'off',
  scheduled_visibility jsonb not null default '{}'::jsonb,
  notification_preferences jsonb not null default '{"nearby_alerts": true, "max_nearby_alerts_per_friend_per_hour": 1}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.rate_limits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  ip_hash text,
  action text not null,
  count integer not null default 0,
  window_start timestamptz not null,
  window_end timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rate_limits_subject_present check (user_id is not null or ip_hash is not null)
);

create table public.consent_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  consent_type text not null,
  consent_text text not null,
  granted boolean not null,
  created_at timestamptz not null default now()
);

create table public.deletion_audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  deleted_user_label text not null default 'Deleted User',
  deletion_reason text,
  deleted_at timestamptz not null default now(),
  retained_billing_reference text,
  retained_report_reference text,
  created_at timestamptz not null default now()
);

create index friend_requests_receiver_status_idx on public.friend_requests(receiver_id, status);
create index friend_requests_sender_status_idx on public.friend_requests(sender_id, status);
create index friendships_user_one_idx on public.friendships(user_one_id);
create index friendships_user_two_idx on public.friendships(user_two_id);
create index notifications_user_read_created_idx on public.notifications(user_id, is_read, created_at desc);
create index proximity_events_user_expires_idx on public.proximity_events(user_id, expires_at);
create index subscriptions_user_idx on public.subscriptions(user_id);
create index subscriptions_stripe_subscription_idx on public.subscriptions(stripe_subscription_id);
create index blocked_users_blocker_blocked_idx on public.blocked_users(blocker_id, blocked_id);
create index reports_reported_status_idx on public.reports(reported_user_id, status);
create index profiles_user_idx on public.profiles(user_id);
create unique index profiles_username_unique_idx on public.profiles(username);
create unique index user_locations_user_unique_idx on public.user_locations(user_id);
create index rate_limits_window_idx on public.rate_limits(action, window_end);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger friend_requests_set_updated_at before update on public.friend_requests for each row execute function public.set_updated_at();
create trigger reports_set_updated_at before update on public.reports for each row execute function public.set_updated_at();
create trigger subscriptions_set_updated_at before update on public.subscriptions for each row execute function public.set_updated_at();
create trigger friend_circles_set_updated_at before update on public.friend_circles for each row execute function public.set_updated_at();
create trigger privacy_zones_set_updated_at before update on public.privacy_zones for each row execute function public.set_updated_at();
create trigger user_preferences_set_updated_at before update on public.user_preferences for each row execute function public.set_updated_at();
create trigger rate_limits_set_updated_at before update on public.rate_limits for each row execute function public.set_updated_at();

create or replace function public.is_friend(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.friendships
    where
      (user_one_id = auth.uid() and user_two_id = target_user_id)
      or
      (user_two_id = auth.uid() and user_one_id = target_user_id)
  );
$$;

create or replace function public.is_blocked_between(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.blocked_users
    where
      (blocker_id = auth.uid() and blocked_id = target_user_id)
      or
      (blocker_id = target_user_id and blocked_id = auth.uid())
  );
$$;

create or replace function public.location_confidence_for_accuracy(location_accuracy double precision)
returns public.location_confidence
language sql
immutable
as $$
  select case
    when location_accuracy between 0 and 100 then 'high'::public.location_confidence
    when location_accuracy <= 500 then 'medium'::public.location_confidence
    else 'low'::public.location_confidence
  end;
$$;

create or replace function public.cleanup_expired_private_location()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer;
begin
  delete from public.user_locations
  where last_updated < now() - interval '30 minutes';

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

create or replace function public.cleanup_expired_proximity_events()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer;
begin
  delete from public.proximity_events
  where expires_at < now();

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

create or replace function public.prepare_deleted_user_reports(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.reports
  set
    reporter_id = case when reporter_id = target_user_id then null else reporter_id end,
    reported_user_id = case when reported_user_id = target_user_id then null else reported_user_id end,
    reported_user_label = case when reported_user_id = target_user_id then 'Deleted User' else reported_user_label end
  where reporter_id = target_user_id or reported_user_id = target_user_id;
end;
$$;

alter table public.profiles enable row level security;
alter table public.friend_requests enable row level security;
alter table public.friendships enable row level security;
alter table public.user_locations enable row level security;
alter table public.proximity_events enable row level security;
alter table public.notifications enable row level security;
alter table public.blocked_users enable row level security;
alter table public.reports enable row level security;
alter table public.subscriptions enable row level security;
alter table public.friend_circles enable row level security;
alter table public.circle_members enable row level security;
alter table public.privacy_zones enable row level security;
alter table public.meetup_requests enable row level security;
alter table public.user_preferences enable row level security;
alter table public.rate_limits enable row level security;
alter table public.consent_logs enable row level security;
alter table public.deletion_audit_logs enable row level security;

create policy "profiles owner full access" on public.profiles
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "friends can view limited profiles" on public.profiles
for select using (
  public.is_friend(user_id)
  and not public.is_blocked_between(user_id)
  and deleted_at is null
);

create policy "friend requests visible to participants" on public.friend_requests
for select using (auth.uid() in (sender_id, receiver_id));
create policy "friend requests sender creates" on public.friend_requests
for insert with check (auth.uid() = sender_id);
create policy "friend requests participants update" on public.friend_requests
for update using (auth.uid() in (sender_id, receiver_id)) with check (auth.uid() in (sender_id, receiver_id));

create policy "friendships visible to participants" on public.friendships
for select using (auth.uid() in (user_one_id, user_two_id));

create policy "location owner only" on public.user_locations
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "proximity owner reads derived signals" on public.proximity_events
for select using (auth.uid() = user_id);

create policy "notifications owner access" on public.notifications
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "blocked users owner access" on public.blocked_users
for all using (auth.uid() = blocker_id) with check (auth.uid() = blocker_id);

create policy "reports reporter creates" on public.reports
for insert with check (auth.uid() = reporter_id);
create policy "reports reporter can read own" on public.reports
for select using (auth.uid() = reporter_id);

create policy "subscriptions owner can read" on public.subscriptions
for select using (auth.uid() = user_id);

create policy "friend circles owner access" on public.friend_circles
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "circle members owner access" on public.circle_members
for all using (
  exists (
    select 1 from public.friend_circles
    where friend_circles.id = circle_members.circle_id
    and friend_circles.user_id = auth.uid()
  )
) with check (
  exists (
    select 1 from public.friend_circles
    where friend_circles.id = circle_members.circle_id
    and friend_circles.user_id = auth.uid()
  )
);

create policy "privacy zones owner only" on public.privacy_zones
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "meetup requests visible to participants" on public.meetup_requests
for select using (auth.uid() in (sender_id, receiver_id));
create policy "meetup requests sender creates" on public.meetup_requests
for insert with check (auth.uid() = sender_id);
create policy "meetup requests participants update" on public.meetup_requests
for update using (auth.uid() in (sender_id, receiver_id)) with check (auth.uid() in (sender_id, receiver_id));

create policy "preferences owner access" on public.user_preferences
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "rate limits owner readable" on public.rate_limits
for select using (auth.uid() = user_id);

create policy "consent logs owner reads" on public.consent_logs
for select using (auth.uid() = user_id);
create policy "consent logs owner creates" on public.consent_logs
for insert with check (auth.uid() = user_id);

create policy "deletion audit owner reads" on public.deletion_audit_logs
for select using (auth.uid() = user_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 5242880, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "avatar owner uploads" on storage.objects
for insert with check (
  bucket_id = 'avatars'
  and auth.uid()::text = (storage.foldername(name))[1]
);

create policy "avatar owner updates" on storage.objects
for update using (
  bucket_id = 'avatars'
  and auth.uid()::text = (storage.foldername(name))[1]
) with check (
  bucket_id = 'avatars'
  and auth.uid()::text = (storage.foldername(name))[1]
);

create policy "avatar owner deletes" on storage.objects
for delete using (
  bucket_id = 'avatars'
  and auth.uid()::text = (storage.foldername(name))[1]
);

create policy "avatars public read" on storage.objects
for select using (bucket_id = 'avatars');
