-- Backend hardening: query indexes and database-backed rate limiting.
-- These changes are additive and non-destructive.

create index if not exists profiles_username_idx on public.profiles(username);
create index if not exists profiles_user_id_idx on public.profiles(user_id);

create index if not exists friend_requests_sender_idx on public.friend_requests(sender_id);
create index if not exists friend_requests_receiver_idx on public.friend_requests(receiver_id);
create index if not exists friend_requests_status_idx on public.friend_requests(status);

create index if not exists friendships_user_one_id_idx on public.friendships(user_one_id);
create index if not exists friendships_user_two_id_idx on public.friendships(user_two_id);

create index if not exists user_locations_user_id_idx on public.user_locations(user_id);

create index if not exists proximity_events_user_id_idx on public.proximity_events(user_id);
create index if not exists proximity_events_expires_at_idx on public.proximity_events(expires_at);

create index if not exists notifications_user_id_idx on public.notifications(user_id);
create index if not exists notifications_is_read_idx on public.notifications(is_read);

create index if not exists subscriptions_user_id_idx on public.subscriptions(user_id);
create index if not exists subscriptions_stripe_subscription_id_idx on public.subscriptions(stripe_subscription_id);

create index if not exists blocked_users_blocker_id_idx on public.blocked_users(blocker_id);
create index if not exists blocked_users_blocked_id_idx on public.blocked_users(blocked_id);

create index if not exists rate_limits_subject_action_window_idx
on public.rate_limits (
  coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(ip_hash, ''),
  action,
  window_start
);

create or replace function public.consume_rate_limit(
  p_user_id uuid,
  p_ip_hash text,
  p_action text,
  p_limit integer,
  p_window_seconds integer
)
returns table (
  allowed boolean,
  remaining integer,
  reset_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_user_id uuid := p_user_id;
  normalized_ip_hash text := nullif(p_ip_hash, '');
  window_seconds integer := greatest(p_window_seconds, 1);
  window_start_value timestamptz;
  window_end_value timestamptz;
  current_count integer;
begin
  if normalized_user_id is null and normalized_ip_hash is null then
    raise exception 'rate limit subject required';
  end if;

  if p_limit < 1 then
    raise exception 'rate limit must be positive';
  end if;

  window_start_value := to_timestamp(
    floor(extract(epoch from now()) / window_seconds) * window_seconds
  );
  window_end_value := window_start_value + make_interval(secs => window_seconds);

  perform pg_advisory_xact_lock(
    hashtext(
      coalesce(normalized_user_id::text, 'anonymous')
      || ':'
      || coalesce(normalized_ip_hash, 'no-ip')
      || ':'
      || p_action
      || ':'
      || window_start_value::text
    )
  );

  select count
  into current_count
  from public.rate_limits
  where
    coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid)
      = coalesce(normalized_user_id, '00000000-0000-0000-0000-000000000000'::uuid)
    and coalesce(ip_hash, '') = coalesce(normalized_ip_hash, '')
    and action = p_action
    and window_start = window_start_value
  for update;

  if current_count is null then
    insert into public.rate_limits (
      user_id,
      ip_hash,
      action,
      count,
      window_start,
      window_end
    )
    values (
      normalized_user_id,
      normalized_ip_hash,
      p_action,
      1,
      window_start_value,
      window_end_value
    );

    current_count := 1;
  else
    current_count := current_count + 1;

    update public.rate_limits
    set count = current_count
    where
      coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid)
        = coalesce(normalized_user_id, '00000000-0000-0000-0000-000000000000'::uuid)
      and coalesce(ip_hash, '') = coalesce(normalized_ip_hash, '')
      and action = p_action
      and window_start = window_start_value;
  end if;

  return query
  select
    current_count <= p_limit,
    greatest(p_limit - current_count, 0),
    window_end_value;
end;
$$;
