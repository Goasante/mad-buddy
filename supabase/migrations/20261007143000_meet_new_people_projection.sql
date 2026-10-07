-- Meet New People projection and notification-safe commands.
-- Nearby eligibility is evaluated on the server; raw creator/viewer coordinates
-- are never returned by this API.

create or replace function public.list_meetup_discoveries_server(p_actor_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  with visible as (
    select d.*
    from public.meetup_discoveries d
    where d.status='active'
      and d.listing_expires_at>now()
      and (
        d.creator_id=p_actor_id
        or public.meetup_discovery_nearby_allowed(p_actor_id,d.creator_id)
      )
    order by d.created_at desc
    limit 100
  ),
  profiles as (
    select p.user_id,p.full_name,p.username,p.avatar_url,p.trusted_member_since
    from public.profiles p
    where p.user_id in (select creator_id from visible)
  )
  select jsonb_build_object(
    'items',
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',d.id,
        'creatorId',d.creator_id,
        'creatorName',case when d.creator_id=p_actor_id then 'You' else coalesce(p.full_name,'Someone nearby') end,
        'creatorUsername',p.username,
        'creatorAvatarUrl',p.avatar_url,
        'creatorTrusted',p.trusted_member_since is not null,
        'title',d.title,
        'category',d.category,
        'style',d.meetup_style,
        'startsAt',d.starts_at,
        'timezone',d.timezone,
        'expiresAt',d.listing_expires_at,
        'maxAttendees',d.max_attendees,
        'interestLimit',d.interest_limit,
        'refreshCount',d.refresh_count,
        'interestCount',(select count(*) from public.meetup_discovery_interests i where i.discovery_id=d.id and i.status in ('pending','accepted')),
        'acceptedCount',(select count(*) from public.meetup_discovery_interests i where i.discovery_id=d.id and i.status='accepted'),
        'myInterestStatus',(select i.status from public.meetup_discovery_interests i where i.discovery_id=d.id and i.user_id=p_actor_id),
        'isOwner',d.creator_id=p_actor_id
      ) order by d.created_at desc)
      from visible d
      left join profiles p on p.user_id=d.creator_id
    ),'[]'::jsonb),
    'ownedInterests',
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'discoveryId',i.discovery_id,
        'userId',i.user_id,
        'name',coalesce(p.full_name,'Someone nearby'),
        'username',p.username,
        'avatarUrl',p.avatar_url,
        'trusted',p.trusted_member_since is not null,
        'status',i.status,
        'createdAt',i.created_at
      ) order by i.created_at)
      from public.meetup_discovery_interests i
      join public.meetup_discoveries d on d.id=i.discovery_id
      join public.profiles p on p.user_id=i.user_id
      where d.creator_id=p_actor_id
        and d.status in ('active','matched')
        and d.listing_expires_at>now()-interval '6 hours'
        and i.status in ('pending','accepted')
        and not exists(
          select 1 from public.blocked_users b
          where (b.blocker_id=p_actor_id and b.blocked_id=i.user_id)
             or (b.blocker_id=i.user_id and b.blocked_id=p_actor_id)
        )
    ),'[]'::jsonb),
    'activeSlots',public.meetup_owner_active_slot_count(p_actor_id),
    'maxSlots',3
  )
$$;

revoke all on function public.list_meetup_discoveries_server(uuid) from public,anon,authenticated;
grant execute on function public.list_meetup_discoveries_server(uuid) to service_role;
