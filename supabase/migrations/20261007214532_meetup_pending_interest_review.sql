-- Existing requests outlive the public posting window, never the meetup start.
alter table public.meetup_discovery_interests drop constraint if exists meetup_discovery_interests_status_check;
alter table public.meetup_discovery_interests add constraint meetup_discovery_interests_status_check
  check (status in ('pending','accepted','declined','withdrawn','expired'));

create or replace function public.expire_meetup_discoveries_server() returns integer
language plpgsql security invoker set search_path='' as $$
declare v_changed integer:=0; v_requests integer:=0;
begin
  update public.meetup_discoveries d set status=case
    when exists(select 1 from public.meetups m where m.source_discovery_id=d.id) then 'matched' else 'expired' end,
    updated_at=now()
  where d.status='active' and (d.listing_expires_at<=now() or d.starts_at<=now());
  get diagnostics v_changed=row_count;
  update public.meetup_discovery_interests i set status='expired',updated_at=now()
  from public.meetup_discoveries d where i.discovery_id=d.id and i.status='pending'
    and (d.starts_at<=now() or d.status='cancelled');
  get diagnostics v_requests=row_count;
  return v_changed+v_requests;
end $$;

create or replace function public.meetup_discovery_command_server(p_actor_id uuid,p_action text,p_input jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
  v_id uuid:=(p_input->>'id')::uuid;
  v_d public.meetup_discoveries;
  v_interest public.meetup_discovery_interests;
  v_count integer;
  v_meetup_id uuid;
  v_conversation_id uuid;
  v_target uuid;
  v_response text;
begin
  if p_actor_id is null or v_id is null then raise exception 'DISCOVERY_INVALID'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_id::text,0));
  perform public.expire_meetup_discoveries_server();

  select * into v_d from public.meetup_discoveries where id=v_id for update;
  if v_d.id is null then raise exception 'DISCOVERY_NOT_FOUND'; end if;

  if p_action='interest' then
    if v_d.status<>'active' or v_d.listing_expires_at<=now() or v_d.starts_at<=clock_timestamp() then raise exception 'DISCOVERY_CLOSED'; end if;
    if not public.meetup_discovery_nearby_allowed(p_actor_id,v_d.creator_id) then raise exception 'DISCOVERY_NOT_NEARBY'; end if;
    select count(*) into v_count from public.meetup_discovery_interests
      where discovery_id=v_id and status in ('pending','accepted');
    if v_count>=v_d.interest_limit then raise exception 'DISCOVERY_FULL'; end if;

    insert into public.meetup_discovery_interests(discovery_id,user_id,status)
      values(v_id,p_actor_id,'pending')
      on conflict(discovery_id,user_id) do update
      set status=case
          when public.meetup_discovery_interests.status='accepted' then 'accepted'
          else 'pending'
        end,
        updated_at=now();

    return jsonb_build_object('id',v_id,'status','pending');

  elsif p_action='withdraw' then
    update public.meetup_discovery_interests
      set status='withdrawn',updated_at=now()
      where discovery_id=v_id and user_id=p_actor_id and status='pending';
    if not found then raise exception 'DISCOVERY_CANNOT_WITHDRAW'; end if;
    return jsonb_build_object('id',v_id,'status','withdrawn');

  elsif p_action='decide' then
    if p_actor_id<>v_d.creator_id then raise exception 'DISCOVERY_ACCESS'; end if;
    if v_d.status='cancelled' or v_d.starts_at<=clock_timestamp() then raise exception 'DISCOVERY_REQUEST_EXPIRED'; end if;
    v_target:=(p_input->>'userId')::uuid;
    v_response:=p_input->>'response';
    if v_target is null or v_response not in ('accepted','declined') then raise exception 'DISCOVERY_INVALID'; end if;
    if exists(select 1 from public.blocked_users b where (b.blocker_id=p_actor_id and b.blocked_id=v_target) or (b.blocker_id=v_target and b.blocked_id=p_actor_id)) then raise exception 'DISCOVERY_NOT_NEARBY'; end if;

    select * into v_interest from public.meetup_discovery_interests
      where discovery_id=v_id and user_id=v_target for update;
    if v_interest.user_id is null or v_interest.status<>'pending' then raise exception 'DISCOVERY_CHANGED'; end if;

    if v_response='declined' then
      update public.meetup_discovery_interests set status='declined',updated_at=now()
       where discovery_id=v_id and user_id=v_target;
      return jsonb_build_object('id',v_id,'status','declined');
    end if;

    select id into v_meetup_id from public.meetups where source_discovery_id=v_id for update;

    if v_meetup_id is null then
      insert into public.meetups(
        creator_id,host_id,mode,place_label,note,starts_at,expires_at,timezone,
        request_key,source_discovery_id,title,category
      ) values(
        p_actor_id,null,'meet_somewhere','Decide in chat','',
        v_d.starts_at,v_d.starts_at+interval '6 hours',v_d.timezone,
        v_d.id,v_d.id,v_d.title,v_d.category
      ) returning id into v_meetup_id;

      insert into public.meetup_participants(meetup_id,user_id,response,proximity_enabled)
        values(v_meetup_id,p_actor_id,'accepted',true),
              (v_meetup_id,v_target,'accepted',true);

      insert into public.conversations(conversation_type,created_by,context_type,context_id)
        values('group',p_actor_id,'meetup',v_meetup_id)
        returning id into v_conversation_id;

      insert into public.group_settings(conversation_id,name,description,visibility)
        values(v_conversation_id,left(v_d.title,80),'Meetup chat','private');

      insert into public.conversation_members(conversation_id,user_id,role,status)
        values(v_conversation_id,p_actor_id,'owner','joined'),
              (v_conversation_id,v_target,'member','joined');
    else
      if v_d.meetup_style<>'group' then raise exception 'DISCOVERY_CLOSED'; end if;
      select count(*) into v_count from public.meetup_participants
        where meetup_id=v_meetup_id and response='accepted';
      if v_count>=v_d.max_attendees then raise exception 'DISCOVERY_FULL'; end if;

      insert into public.meetup_participants(meetup_id,user_id,response,proximity_enabled)
        values(v_meetup_id,v_target,'accepted',true)
        on conflict(meetup_id,user_id) do update
        set response='accepted',proximity_enabled=true;

      select id into v_conversation_id from public.conversations
       where context_type='meetup' and context_id=v_meetup_id and status<>'deleted'
       limit 1;

      insert into public.conversation_members(conversation_id,user_id,role,status)
        values(v_conversation_id,v_target,'member','joined')
        on conflict(conversation_id,user_id) do update
        set status='joined',left_at=null,updated_at=now();
    end if;

    update public.meetup_discovery_interests set status='accepted',updated_at=now()
      where discovery_id=v_id and user_id=v_target;

    select count(*) into v_count from public.meetup_discovery_interests
      where discovery_id=v_id and status='accepted';
    update public.meetup_discoveries
      set status=case
          when listing_expires_at<=now() or meetup_style='one_to_one' or v_count>=max_attendees-1 then 'matched'
          else 'active'
        end,
        updated_at=now()
      where id=v_id;

    return jsonb_build_object(
      'id',v_id,'status','accepted','meetupId',v_meetup_id,'conversationId',v_conversation_id
    );

  elsif p_action='close' then
    if p_actor_id<>v_d.creator_id then raise exception 'DISCOVERY_ACCESS'; end if;
    update public.meetup_discoveries
      set status=case
          when exists(select 1 from public.meetups m where m.source_discovery_id=v_id) then 'matched'
          else 'cancelled'
        end,
        updated_at=now()
      where id=v_id;
    return jsonb_build_object('id',v_id,'status','closed');

  elsif p_action='refresh' then
    if p_actor_id<>v_d.creator_id then raise exception 'DISCOVERY_ACCESS'; end if;
    if v_d.refresh_count>=2 then raise exception 'DISCOVERY_REFRESH_LIMIT'; end if;
    if v_d.starts_at<=now()+interval '1 minute' then raise exception 'DISCOVERY_CLOSED'; end if;
    if exists(
      select 1 from public.meetups m
      join public.meetup_participants p on p.meetup_id=m.id and p.response='accepted'
      where m.source_discovery_id=v_id
      group by m.id
      having count(*)>=v_d.max_attendees
    ) then raise exception 'DISCOVERY_FULL'; end if;

    update public.meetup_discoveries
      set status='active',
          listing_expires_at=now()+make_interval(mins=>listing_duration_minutes),
          refresh_count=refresh_count+1,
          updated_at=now()
      where id=v_id;
    return jsonb_build_object('id',v_id,'status','active');

  else
    raise exception 'DISCOVERY_INVALID';
  end if;
end $$;

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
      (d.status='active' and d.listing_expires_at>now() and d.starts_at>now())
      or (d.creator_id=p_actor_id and d.status='matched' and d.listing_expires_at>now()-interval '6 hours')
      or (d.creator_id=p_actor_id and d.status<>'cancelled' and d.starts_at>now()
          and exists(select 1 from public.meetup_discovery_interests i where i.discovery_id=d.id and i.status='pending'))
      or exists(select 1 from public.meetup_discovery_interests i where i.discovery_id=d.id and i.user_id=p_actor_id
          and (i.status='pending' or (i.status in ('expired','declined') and i.updated_at>now()-interval '24 hours')))
    )
      and (
        d.creator_id=p_actor_id
        or public.meetup_discovery_nearby_allowed(p_actor_id,d.creator_id)
        or exists(select 1 from public.meetup_discovery_interests i where i.discovery_id=d.id and i.user_id=p_actor_id and i.status in ('pending','expired','declined'))
      )
    and (d.creator_id=p_actor_id or not exists(select 1 from public.blocked_users b
        where (b.blocker_id=p_actor_id and b.blocked_id=d.creator_id) or (b.blocker_id=d.creator_id and b.blocked_id=p_actor_id)))
    order by (d.creator_id=p_actor_id) desc, d.created_at desc
    limit 200
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
    'nearby',coalesce((select jsonb_agg(item order by created_at desc) from projected where creator_id<>p_actor_id and item->>'status'='active' and (item->>'listingExpiresAt')::timestamptz>now() and (item->>'startsAt')::timestamptz>now() and public.meetup_discovery_nearby_allowed(p_actor_id,creator_id)),'[]'::jsonb),
    'requests',coalesce((select jsonb_agg(item order by created_at desc) from projected where creator_id<>p_actor_id and item->>'myInterestStatus' in ('pending','expired','declined')),'[]'::jsonb),
    'mine',coalesce((select jsonb_agg(item order by created_at desc) from projected where creator_id=p_actor_id),'[]'::jsonb),
    'activeSlots',public.meetup_owner_active_slot_count(p_actor_id),
    'maxActiveSlots',3
  )
$$;


revoke all on function public.expire_meetup_discoveries_server(), public.meetup_discovery_command_server(uuid,text,jsonb), public.list_meetup_discoveries_server(uuid) from public,anon,authenticated;
grant execute on function public.expire_meetup_discoveries_server(), public.meetup_discovery_command_server(uuid,text,jsonb), public.list_meetup_discoveries_server(uuid) to service_role;

