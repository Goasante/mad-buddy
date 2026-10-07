-- Keep the Meet New People server projection aligned with the client refresh-limit contract.
create or replace function public.list_meetup_discoveries_server(p_actor_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with all_rows as (
    select d.*
    from public.meetup_discoveries d
    where (
      (d.status='active' and d.listing_expires_at>now())
      or (d.creator_id=p_actor_id and d.status='matched' and d.listing_expires_at>now()-interval '6 hours')
    )
      and (
        d.creator_id=p_actor_id
        or public.meetup_discovery_nearby_allowed(p_actor_id,d.creator_id)
      )
    order by d.created_at desc
    limit 100
  ),
  projected as (
    select
      d.creator_id,
      d.created_at,
      jsonb_build_object(
        'id',d.id,
        'creatorId',d.creator_id,
        'creatorName',case when d.creator_id=p_actor_id then 'You' else coalesce(p.full_name,'Someone nearby') end,
        'creatorUsername',coalesce(p.username,''),
        'creatorAvatarUrl',p.avatar_url,
        'title',d.title,
        'category',d.category,
        'style',d.meetup_style,
        'startsAt',d.starts_at,
        'timezone',d.timezone,
        'listingExpiresAt',d.listing_expires_at,
        'listingDurationMinutes',d.listing_duration_minutes,
        'status',d.status,
        'maxAttendees',d.max_attendees,
        'interestLimit',d.interest_limit,
        'interestCount',(select count(*) from public.meetup_discovery_interests i where i.discovery_id=d.id and i.status in ('pending','accepted')),
        'refreshCount',d.refresh_count,
        'myInterestStatus',(select i.status from public.meetup_discovery_interests i where i.discovery_id=d.id and i.user_id=p_actor_id),
        'meetupId',(
          select m.id from public.meetups m
          where m.source_discovery_id=d.id
            and (
              d.creator_id=p_actor_id
              or exists(select 1 from public.meetup_participants mp where mp.meetup_id=m.id and mp.user_id=p_actor_id and mp.response='accepted')
            )
          limit 1
        ),
        'conversationId',(
          select c.id
          from public.meetups m
          join public.conversations c on c.context_type='meetup' and c.context_id=m.id and c.status<>'deleted'
          join public.conversation_members cm on cm.conversation_id=c.id and cm.user_id=p_actor_id and cm.status='joined'
          where m.source_discovery_id=d.id
          limit 1
        ),
        'interestedPeople',
          case when d.creator_id=p_actor_id then
            coalesce((
              select jsonb_agg(jsonb_build_object(
                'userId',i.user_id,
                'name',coalesce(ip.full_name,'Someone nearby'),
                'username',coalesce(ip.username,''),
                'avatarUrl',ip.avatar_url,
                'status',i.status
              ) order by i.created_at)
              from public.meetup_discovery_interests i
              join public.profiles ip on ip.user_id=i.user_id
              where i.discovery_id=d.id
                and i.status in ('pending','accepted')
                and not exists(
                  select 1 from public.blocked_users b
                  where (b.blocker_id=p_actor_id and b.blocked_id=i.user_id)
                     or (b.blocker_id=i.user_id and b.blocked_id=p_actor_id)
                )
            ),'[]'::jsonb)
          else '[]'::jsonb end
      ) item
    from all_rows d
    left join public.profiles p on p.user_id=d.creator_id
  )
  select jsonb_build_object(
    'nearby',coalesce((select jsonb_agg(item order by created_at desc) from projected where creator_id<>p_actor_id),'[]'::jsonb),
    'mine',coalesce((select jsonb_agg(item order by created_at desc) from projected where creator_id=p_actor_id),'[]'::jsonb),
    'activeSlots',public.meetup_owner_active_slot_count(p_actor_id),
    'maxActiveSlots',3
  )
$$;
