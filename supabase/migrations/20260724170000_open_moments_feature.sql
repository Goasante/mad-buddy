-- Open Moments: an optional, admin-controlled public discovery audience.
--
-- Privacy and safety invariants:
--   * Disabled by default.
--   * Public means authenticated Mad Buddy members, never the open internet.
--   * No coordinates, distance, routes, or location history are added.
--   * Existing blocks, report-and-hide, expiry, moderation, and private media
--     signing remain authoritative.
--   * Buddy Pro publishing is enforced by the application service, not the UI.

insert into public.feature_flags (
  key,
  description,
  status,
  default_value
)
values (
  'open_moments',
  'Allows authenticated members to view Open Moments and Buddy Pro members to publish them.',
  'off',
  false
)
on conflict (key) do update
set description = excluded.description;

-- Expand the existing audience enum-like check without changing any stored
-- private Moment. Existing rows keep their current audience.
alter table public.moments
  drop constraint if exists moments_audience_type_check;

alter table public.moments
  add constraint moments_audience_type_check check (
    audience_type in (
      'close_friends',
      'selected_muddies',
      'selected_circles',
      'nearby_muddies',
      'event_circle',
      'plan',
      'public'
    )
  );

create index if not exists moments_open_feed_idx
  on public.moments(created_at desc)
  where audience_type = 'public' and status = 'active';

-- Defence in depth for direct Supabase clients. The application service is the
-- canonical entitlement resolver; this function mirrors the public-Moment
-- boolean at the RLS boundary so a crafted client cannot bypass it.
create or replace function public.can_publish_open_moments(subject_user_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  feature_on boolean := false;
  effective_plan text := 'free';
  user_override boolean;
  tier_override boolean;
begin
  select exists (
    select 1
    from public.feature_flags f
    where f.key = 'open_moments'
      and f.status = 'on'
  ) into feature_on;

  if not feature_on then
    return false;
  end if;

  -- A currently active user override takes precedence.
  select eo.boolean_value
  into user_override
  from public.entitlement_overrides eo
  where eo.subject_type = 'user'
    and eo.subject_id = subject_user_id
    and eo.entitlement_key = 'public_moments'
    and eo.value_type = 'boolean'
    and (eo.starts_at is null or eo.starts_at <= now())
    and (eo.ends_at is null or eo.ends_at > now())
  order by eo.created_at desc
  limit 1;

  if found then
    return coalesce(user_override, false);
  end if;

  select case
    when s.plan = 'buddy_pro'
      and s.status in ('active', 'trialing', 'non_renewing', 'past_due', 'attention')
      and (s.grace_ends_at is null or s.grace_ends_at > now())
      and (
        s.status in ('active', 'trialing')
        or s.current_period_end is null
        or s.current_period_end > now()
        or (s.grace_ends_at is not null and s.grace_ends_at > now())
      )
    then 'buddy_pro'
    else 'free'
  end
  into effective_plan
  from public.subscriptions s
  where s.user_id = subject_user_id;

  -- Honour a tier-level boolean override when one exists.
  select teo.boolean_value
  into tier_override
  from public.tier_entitlement_overrides teo
  where teo.plan = effective_plan
    and teo.entitlement_key = 'public_moments'
    and teo.value_type = 'boolean'
  limit 1;

  if found then
    return coalesce(tier_override, false);
  end if;

  return effective_plan = 'buddy_pro';
end;
$$;

revoke all on function public.can_publish_open_moments(uuid) from public;
grant execute on function public.can_publish_open_moments(uuid) to authenticated;

-- Replace the broad author policy so public INSERT/UPDATE receives the extra
-- feature and entitlement check. Private Moment behavior stays unchanged.
drop policy if exists "moments author full access" on public.moments;

create policy "moments author read" on public.moments
  for select using (auth.uid() = author_id);

create policy "moments author insert" on public.moments
  for insert with check (
    auth.uid() = author_id
    and (
      audience_type <> 'public'
      or public.can_publish_open_moments(auth.uid())
    )
  );

create policy "moments author update" on public.moments
  for update using (auth.uid() = author_id)
  with check (
    auth.uid() = author_id
    and (
      audience_type <> 'public'
      or public.can_publish_open_moments(auth.uid())
    )
  );

create policy "moments author delete" on public.moments
  for delete using (auth.uid() = author_id);

-- Direct authenticated reads are permitted only for live public Moments and
-- still respect blocks. The app service adds feature-flag, Ghost Mode,
-- report-and-hide, and media-signing checks before returning its feed.
create policy "members read active public moments" on public.moments
  for select to authenticated
  using (
    audience_type = 'public'
    and status = 'active'
    and expires_at > now()
    and exists (
      select 1
      from public.feature_flags f
      where f.key = 'open_moments'
        and f.status = 'on'
    )
    and not exists (
      select 1
      from public.blocked_users b
      where (b.blocker_id = auth.uid() and b.blocked_id = moments.author_id)
         or (b.blocker_id = moments.author_id and b.blocked_id = auth.uid())
    )
  );
