-- Expose non-sensitive Meetup presentation metadata for Home/Meet Up.
create or replace function public.list_meetups_server(p_actor_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(entry order by starts_at),'[]'::jsonb) from (
    select m.starts_at, jsonb_build_object(
      'id',m.id,'creatorId',m.creator_id,'hostId',m.host_id,'mode',m.mode,
      'placeLabel',m.place_label,'note',m.note,'title',m.title,'category',m.category,
      'sourceDiscoveryId',m.source_discovery_id,
      'startsAt',m.starts_at,'expiresAt',m.expires_at,
      'timezone',m.timezone,'status',m.status,'revision',m.revision,
      'beaconStatus',case
        when m.beacon_latitude is null then 'unset'
        when m.beacon_confirmed_at is null then 'provisional'
        else 'locked'
      end,
      'togetherAt',m.together_at,
      'members',(select coalesce(jsonb_agg(jsonb_build_object(
        'key',md5(p.user_id::text || m.id::text),
        'userId',case when public.meetup_pair_allowed(p_actor_id,p.user_id) then p.user_id end,
        'name',case when public.meetup_pair_allowed(p_actor_id,p.user_id) then coalesce(pr.full_name,'A Muddy') else 'Another Muddy' end,
        'response',p.response,'arrival',p.arrival,'delayMinutes',p.delay_minutes,
        'metAt',p.met_at,'journeyState',p.journey_state,'observedAt',p.proximity_observed_at,
        'homeStartedAt',p.home_started_at,'homeArrivedAt',p.home_arrived_at,
        'suggestedStartAt',case when p_actor_id=m.creator_id or p_actor_id=p.user_id then p.suggested_start_at end
      ) order by p.user_id),'[]'::jsonb)
      from public.meetup_participants p
      left join public.profiles pr on pr.user_id=p.user_id
      where p.meetup_id=m.id),
      'activity',(select coalesce(jsonb_agg(jsonb_build_object(
        'id',a.id,
        'actorId',case when a.actor_id is not null and public.meetup_pair_allowed(p_actor_id,a.actor_id) then a.actor_id end,
        'actorName',case
          when a.actor_id=p_actor_id then 'You'
          when a.actor_id is not null and public.meetup_pair_allowed(p_actor_id,a.actor_id) then coalesce(ap.full_name,'A Muddy')
          else 'A Muddy'
        end,
        'event',a.event,'detail',a.detail,'createdAt',a.created_at
      ) order by a.created_at desc),'[]'::jsonb)
      from (
        select * from public.meetup_activity x
        where x.meetup_id=m.id order by x.created_at desc limit 12
      ) a
      left join public.profiles ap on ap.user_id=a.actor_id)
    ) entry
    from public.meetups m
    join public.meetup_participants mine on mine.meetup_id=m.id and mine.user_id=p_actor_id
    where public.meetup_pair_allowed(p_actor_id,m.creator_id)
      and (m.host_id is null or public.meetup_pair_allowed(p_actor_id,m.host_id))
      and (
        (m.status='active' and now()<m.expires_at)
        or (
          m.expires_at>now()-interval '12 hours'
          and exists(
            select 1 from public.meetup_participants home
            where home.meetup_id=m.id
              and home.home_started_at is not null
              and home.home_arrived_at is null
          )
        )
      )
    order by m.starts_at
    limit 100
  ) visible
$$;

revoke all on function public.list_meetups_server(uuid) from public,anon,authenticated;
grant execute on function public.list_meetups_server(uuid) to service_role;
