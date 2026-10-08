-- Listings, pending interest, and arranged Meetups have separate lifecycles.
alter table public.meetup_discoveries add column if not exists deleted_at timestamptz;
alter table public.meetup_discoveries drop constraint if exists meetup_discoveries_listing_duration_minutes_check;
alter table public.meetup_discoveries add constraint meetup_discoveries_listing_duration_minutes_check
  check (listing_duration_minutes in (0,30,60,120,240));
alter table public.meetups add column if not exists ended_at timestamptz;
alter table public.meetups add column if not exists end_reason text check (end_reason in ('ended','cancelled','expired'));
-- Previously ended items should not reappear as if they just ended.
update public.meetups set ended_at=least(expires_at,now()-interval '25 hours'),
  end_reason=case when status='cancelled' then 'cancelled' else 'ended' end
where status<>'active' and ended_at is null;

create or replace function public.stamp_meetup_end() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if new.status<>'active' and (old.status='active' or new.ended_at is null) then
    new.ended_at:=now();
    new.end_reason:=coalesce(new.end_reason,case when new.status='cancelled' then 'cancelled' when now()>=new.expires_at then 'expired' else 'ended' end);
  end if;
  return new;
end $$;
drop trigger if exists meetups_stamp_end on public.meetups;
create trigger meetups_stamp_end before update of status on public.meetups
for each row execute function public.stamp_meetup_end();

create or replace function public.meetup_owner_active_slot_count(p_actor_id uuid) returns integer
language sql stable security invoker set search_path='' as $$
  select count(*)::integer from public.meetup_discoveries d
  where d.creator_id=p_actor_id and d.deleted_at is null and d.status='active'
    and d.listing_expires_at>now() and d.starts_at>now();
$$;


create or replace function public.expire_meetup_discoveries_server() returns integer
language plpgsql security invoker set search_path='' as $$
declare v_changed integer:=0;
begin
  update public.meetup_discoveries d
  set status=case
      when exists(select 1 from public.meetups m where m.source_discovery_id=d.id) then 'matched'
      else 'expired'
    end,
    updated_at=now()
  where d.deleted_at is null and d.status='active' and (d.listing_expires_at<=now() or d.starts_at<=now());
  get diagnostics v_changed=row_count;
  return v_changed;
end $$;

create or replace function public.create_meetup_discovery_server(p_actor_id uuid,p_input jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
  v_existing uuid;
  v_start timestamptz;
  v_duration integer;
  v_style text;
  v_title text;
  v_category text;
  v_timezone text;
  v_id uuid;
begin
  if p_actor_id is null or (p_input->>'requestKey') is null then raise exception 'DISCOVERY_INVALID'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_actor_id::text,0));

  select id into v_existing from public.meetup_discoveries
   where creator_id=p_actor_id and request_key=(p_input->>'requestKey')::uuid;
  if v_existing is not null then return jsonb_build_object('id',v_existing); end if;

  perform public.expire_meetup_discoveries_server();
  if public.meetup_owner_active_slot_count(p_actor_id)>=3 then raise exception 'MEETUP_LIMIT'; end if;

  if not exists(
    select 1 from public.user_locations l
    join public.profiles p on p.user_id=l.user_id
    where l.user_id=p_actor_id
      and l.last_updated>now()-interval '60 minutes'
      and p.visibility_status::text='visible'
  ) then raise exception 'DISCOVERY_LOCATION_REQUIRED'; end if;

  v_start:=(p_input->>'startsAt')::timestamptz;
  v_duration:=(p_input->>'durationMinutes')::integer;
  v_style:=p_input->>'style';
  v_title:=btrim(p_input->>'title');
  v_category:=p_input->>'category';
  v_timezone:=p_input->>'timezone';

  if v_start is null or v_start<=now()+interval '1 minute' then raise exception 'MEETUP_TIME'; end if;
  if v_duration not in (0,30,60,120,240) then raise exception 'DISCOVERY_INVALID'; end if;
  if v_style not in ('one_to_one','group') then raise exception 'DISCOVERY_INVALID'; end if;
  if v_category not in ('food','study','sports','gym','walk','gaming','chill','anything','coffee','football','drinks','movie','drive','party') then raise exception 'DISCOVERY_INVALID'; end if;
  if char_length(v_title)<2 or char_length(v_title)>40
     or array_length(regexp_split_to_array(v_title,'\s+'),1)>5 then raise exception 'DISCOVERY_TITLE'; end if;
  if not exists(select 1 from pg_catalog.pg_timezone_names where name=v_timezone) then raise exception 'MEETUP_TIME'; end if;

  insert into public.meetup_discoveries(
    creator_id,title,category,meetup_style,starts_at,timezone,
    listing_duration_minutes,listing_expires_at,max_attendees,request_key
  ) values(
    p_actor_id,v_title,v_category,v_style,v_start,v_timezone,
    v_duration,case when v_duration=0 then v_start else least(v_start,now()+make_interval(mins=>v_duration)) end,
    case when v_style='one_to_one' then 2 else 6 end,
    (p_input->>'requestKey')::uuid
  ) returning id into v_id;

  return jsonb_build_object('id',v_id);
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
  if v_d.id is null or v_d.deleted_at is not null then raise exception 'DISCOVERY_NOT_FOUND'; end if;

  if p_action='interest' then
    if v_d.status<>'active' or v_d.listing_expires_at<=now() or v_d.starts_at<=now() then raise exception 'DISCOVERY_CLOSED'; end if;
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
    v_target:=(p_input->>'userId')::uuid;
    v_response:=p_input->>'response';
    if v_target is null or v_response not in ('accepted','declined') then raise exception 'DISCOVERY_INVALID'; end if;

    select * into v_interest from public.meetup_discovery_interests
      where discovery_id=v_id and user_id=v_target for update;
    if v_interest.user_id is null or v_interest.status<>'pending' then raise exception 'DISCOVERY_CHANGED'; end if;

    if v_response='declined' then
      update public.meetup_discovery_interests set status='declined',updated_at=now()
       where discovery_id=v_id and user_id=v_target;
      return jsonb_build_object('id',v_id,'status','declined');
    end if;

    -- Pending requests survive listing expiry, but acceptance ends at meetup time.
    if v_d.starts_at<=now() then raise exception 'DISCOVERY_CLOSED'; end if;
    if exists(select 1 from public.blocked_users b where (b.blocker_id=p_actor_id and b.blocked_id=v_target) or (b.blocker_id=v_target and b.blocked_id=p_actor_id)) then raise exception 'DISCOVERY_ACCESS'; end if;
    select id into v_meetup_id from public.meetups where source_discovery_id=v_id for update;
    if v_meetup_id is not null and exists(select 1 from public.meetups m where m.id=v_meetup_id and m.status<>'active') then
      raise exception 'DISCOVERY_CLOSED';
    end if;

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
        where meetup_id=v_meetup_id and response in ('accepted','invited');
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
          when meetup_style='one_to_one' or v_count>=max_attendees-1 then 'matched'
          when listing_expires_at<=now() or status in ('expired','cancelled','matched') then 'expired'
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
      set status='cancelled',
        updated_at=now()
      where id=v_id;
    return jsonb_build_object('id',v_id,'status','closed');

  elsif p_action='delete' then
    if p_actor_id<>v_d.creator_id then raise exception 'DISCOVERY_ACCESS'; end if;
    if v_d.status='active' and v_d.listing_expires_at>now() and v_d.starts_at>now() then
      raise exception 'DISCOVERY_CLOSE_FIRST';
    end if;
    update public.meetup_discoveries set deleted_at=now(),updated_at=now() where id=v_id;
    update public.meetup_discovery_interests set status='withdrawn',updated_at=now()
      where discovery_id=v_id and status='pending';
    return jsonb_build_object('id',v_id,'status','deleted');

  elsif p_action='refresh' then
    if p_actor_id<>v_d.creator_id then raise exception 'DISCOVERY_ACCESS'; end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_actor_id::text,0));
    if v_d.refresh_count>=2 then raise exception 'DISCOVERY_REFRESH_LIMIT'; end if;
    if v_d.starts_at<=now()+interval '1 minute' then raise exception 'DISCOVERY_CLOSED'; end if;
    if v_d.meetup_style='one_to_one' and exists(select 1 from public.meetups m where m.source_discovery_id=v_id) then raise exception 'DISCOVERY_CLOSED'; end if;
    if exists(select 1 from public.meetups m where m.source_discovery_id=v_id and m.status<>'active') then raise exception 'DISCOVERY_CLOSED'; end if;
    if exists(
      select 1 from public.meetups m
      join public.meetup_participants p on p.meetup_id=m.id and p.response in ('accepted','invited')
      where m.source_discovery_id=v_id
      group by m.id
      having count(*)>=v_d.max_attendees
    ) then raise exception 'DISCOVERY_FULL'; end if;

    update public.meetup_discoveries
      set status='active',
          listing_expires_at=case when listing_duration_minutes=0 then starts_at else least(starts_at,now()+make_interval(mins=>listing_duration_minutes)) end,
          refresh_count=refresh_count+1,
          updated_at=now()
      where id=v_id;
    return jsonb_build_object('id',v_id,'status','active');

  else
    raise exception 'DISCOVERY_INVALID';
  end if;
end $$;

create or replace function public.sync_discovery_interest_from_meetup_response() returns trigger
language plpgsql security invoker set search_path='' as $$
declare v_discovery uuid; v_conversation uuid;
begin
  if old.response='accepted' and new.response='declined' then
    select source_discovery_id into v_discovery from public.meetups where id=new.meetup_id;
    if v_discovery is not null then
      update public.meetup_discovery_interests
        set status='withdrawn',updated_at=now()
        where discovery_id=v_discovery and user_id=new.user_id and status='accepted';

      select id into v_conversation from public.conversations
       where context_type='meetup' and context_id=new.meetup_id and status<>'deleted' limit 1;
      if v_conversation is not null then
        update public.conversation_members
          set status='left',left_at=now(),updated_at=now()
          where conversation_id=v_conversation and user_id=new.user_id;
      end if;

      -- Departure always succeeds. The creator can explicitly Renew a closed
      -- group listing if they want to fill the vacated seat and have a free slot.
    end if;
  end if;
  return new;
end $$;

create or replace function public.meetup_command_server(p_actor_id uuid,p_action text,p_input jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_id uuid;
  v_key uuid := (p_input->>'requestKey')::uuid;
  v_m public.meetups;
  v_me public.meetup_participants;
  v_ids uuid[];
  v_other uuid;
  v_start timestamptz;
  v_host uuid;
  v_result jsonb;
  v_event text;
  v_new text;
  v_loc record;
  v_distance double precision;
  v_accepted integer;
  v_left integer;
  v_detail jsonb := '{}'::jsonb;
begin
  if p_actor_id is null or v_key is null then raise exception 'MEETUP_INVALID'; end if;

  if p_action='create' then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_actor_id::text,0));
    select id into v_id from public.meetups where creator_id=p_actor_id and request_key=v_key;
    if v_id is not null then return jsonb_build_object('id',v_id); end if;

    if (select count(*) from public.meetups where creator_id=p_actor_id and status='active' and expires_at>now())>=20 then
      raise exception 'MEETUP_LIMIT';
    end if;

    select array_agg(distinct value::uuid) into v_ids from jsonb_array_elements_text(p_input->'participantIds');
    if coalesce(cardinality(v_ids),0)<1 or cardinality(v_ids)>49 or p_actor_id=any(v_ids) then
      raise exception 'MEETUP_INVALID';
    end if;
    foreach v_other in array v_ids loop
      if not public.meetup_pair_allowed(p_actor_id,v_other) then raise exception 'MEETUP_NOT_MUDDIES'; end if;
    end loop;

    if p_input->>'mode'='coming_to' and cardinality(v_ids)<>1 then raise exception 'MEETUP_INVALID'; end if;
    v_host := case p_input->>'mode' when 'come_over' then p_actor_id when 'coming_to' then v_ids[1] end;
    v_start := (p_input->>'startsAt')::timestamptz;
    if v_start is null or v_start<=now()+interval '1 minute' then raise exception 'MEETUP_TIME'; end if;
    if not exists(select 1 from pg_catalog.pg_timezone_names where name=p_input->>'timezone') then raise exception 'MEETUP_TIME'; end if;

    insert into public.meetups(
      creator_id,host_id,mode,place_label,note,starts_at,expires_at,timezone,request_key
    ) values(
      p_actor_id,v_host,p_input->>'mode',btrim(p_input->>'placeLabel'),coalesce(p_input->>'note',''),
      v_start,v_start+interval '6 hours',p_input->>'timezone',v_key
    ) returning * into v_m;

    insert into public.meetup_participants(meetup_id,user_id,response,proximity_enabled)
      values(v_m.id,p_actor_id,'accepted',true);
    insert into public.meetup_participants(meetup_id,user_id)
      select v_m.id,unnest(v_ids);

    v_event := 'invited';
    insert into public.meetup_activity(meetup_id,actor_id,event)
      values(v_m.id,p_actor_id,'created');
  else
    select * into v_m from public.meetups where id=(p_input->>'id')::uuid for update;
    if v_m.id is null then raise exception 'MEETUP_NOT_FOUND'; end if;

    select * into v_me from public.meetup_participants
    where meetup_id=v_m.id and user_id=p_actor_id;
    if v_me.user_id is null
      or not public.meetup_pair_allowed(p_actor_id,v_m.creator_id)
      or (v_m.host_id is not null and not public.meetup_pair_allowed(p_actor_id,v_m.host_id)) then
      raise exception 'MEETUP_ACCESS';
    end if;

    select result into v_result from public.meetup_mutations
    where meetup_id=v_m.id and actor_id=p_actor_id and request_key=v_key;
    if v_result is not null then return v_result; end if;

    if (p_input->>'revision') is null or v_m.revision<>(p_input->>'revision')::integer then
      raise exception 'MEETUP_CHANGED';
    end if;

    if v_m.status<>'active' and p_action<>'home_arrived' then raise exception 'MEETUP_ENDED'; end if;
    if v_m.status='active' and now()>=v_m.expires_at and p_action<>'home_arrived' then
      raise exception 'MEETUP_ENDED';
    end if;

    if p_action='respond' then
      v_new := p_input->>'response';
      if v_new not in ('accepted','declined') or p_actor_id=v_m.creator_id then raise exception 'MEETUP_INVALID'; end if;
      update public.meetup_participants
      set response=v_new,arrival='not_started',delay_minutes=null,met_at=null,suggested_start_at=null,
          proximity_enabled=(v_new='accepted'),journey_state='waiting',proximity_observed_at=null,
          home_started_at=null,home_arrived_at=null
      where meetup_id=v_m.id and user_id=p_actor_id;

      if v_new='declined' and p_actor_id=v_m.host_id then
        update public.meetups set status='cancelled' where id=v_m.id returning * into v_m;
        v_event:='cancelled';
      else
        v_event:=v_new;
      end if;

    elsif p_action='suggest' then
      v_start:=(p_input->>'startsAt')::timestamptz;
      if v_start is null or v_start<=now()+interval '1 minute' then raise exception 'MEETUP_TIME'; end if;
      update public.meetup_participants set suggested_start_at=v_start
      where meetup_id=v_m.id and user_id=p_actor_id;
      v_event:='suggested';
      v_detail:=jsonb_build_object('startsAt',v_start);

    elsif p_action='place' then
      if p_actor_id<>v_m.creator_id and p_actor_id is distinct from v_m.host_id then raise exception 'MEETUP_ACCESS'; end if;
      if nullif(btrim(p_input->>'placeLabel'),'') is null or length(btrim(p_input->>'placeLabel'))>120 then raise exception 'MEETUP_INVALID'; end if;
      if exists(select 1 from public.meetup_participants where meetup_id=v_m.id and met_at is not null) then raise exception 'MEETUP_PLACE_LOCKED'; end if;
      update public.meetups set place_label=btrim(p_input->>'placeLabel'),revision=revision+1,
        beacon_latitude=null,beacon_longitude=null,beacon_set_by=null,beacon_set_at=null,beacon_confirmed_at=null
      where id=v_m.id returning * into v_m;
      update public.meetup_participants set arrival=case when arrival='here' then 'not_started' else arrival end,
        journey_state=case when arrival='here' then 'waiting' else journey_state end,proximity_observed_at=null
      where meetup_id=v_m.id;
      v_event:='place_changed';
      v_detail:=jsonb_build_object('placeLabel',v_m.place_label);

    elsif p_action='reschedule' then
      if p_actor_id<>v_m.creator_id then raise exception 'MEETUP_ACCESS'; end if;
      v_start:=(p_input->>'startsAt')::timestamptz;
      if v_start is null or v_start<=now()+interval '1 minute' then raise exception 'MEETUP_TIME'; end if;

      update public.meetups
      set starts_at=v_start,expires_at=v_start+interval '6 hours',arranged_at=now(),revision=revision+1,
          beacon_latitude=null,beacon_longitude=null,beacon_set_by=null,beacon_set_at=null,
          beacon_confirmed_at=null,together_at=null
      where id=v_m.id returning * into v_m;

      update public.meetup_participants
      set response=case when user_id=p_actor_id then 'accepted' else 'invited' end,
          arrival='not_started',delay_minutes=null,met_at=null,suggested_start_at=null,
          proximity_enabled=(user_id=p_actor_id),journey_state='waiting',proximity_observed_at=null,
          home_started_at=null,home_arrived_at=null
      where meetup_id=v_m.id and response<>'declined';

      update public.meetup_discoveries set starts_at=v_start,
        listing_expires_at=case when listing_duration_minutes=0 then v_start else least(listing_expires_at,v_start) end,
        updated_at=now() where id=v_m.source_discovery_id;
      v_event:='rescheduled';
      v_detail:=jsonb_build_object('startsAt',v_start);

    elsif p_action='beacon' then
      if v_m.source_discovery_id is not null and v_m.place_label='Decide in chat' then raise exception 'MEETUP_PLACE_REQUIRED'; end if;
      if v_me.response<>'accepted' then raise exception 'MEETUP_ACCEPT_FIRST'; end if;
      if now()<v_m.starts_at-interval '2 hours' or now()>=v_m.expires_at then raise exception 'MEETUP_TOO_EARLY'; end if;

      select latitude,longitude,last_updated into v_loc
      from public.user_locations where user_id=p_actor_id;
      if not found
        or v_loc.last_updated<now()-interval '2 minutes'
        or v_loc.last_updated>now()+interval '15 seconds' then
        raise exception 'MEETUP_LOCATION_REQUIRED';
      end if;

      if v_m.beacon_latitude is null then
        if v_m.mode<>'meet_somewhere' and p_actor_id is distinct from v_m.host_id then
          raise exception 'MEETUP_HOST_BEACON';
        end if;

        update public.meetups
        set beacon_latitude=v_loc.latitude,beacon_longitude=v_loc.longitude,
            beacon_set_by=p_actor_id,beacon_set_at=now(),
            beacon_confirmed_at=case when mode='meet_somewhere' then null else now() end
        where id=v_m.id returning * into v_m;

        update public.meetup_participants
        set arrival='here',journey_state='here',proximity_observed_at=now()
        where meetup_id=v_m.id and user_id=p_actor_id;

        v_event:=case when v_m.beacon_confirmed_at is null then 'beacon_set' else 'beacon_locked' end;
      elsif v_m.beacon_confirmed_at is null and p_actor_id is distinct from v_m.beacon_set_by then
        v_distance:=public.meetup_distance_m(
          v_loc.latitude,v_loc.longitude,v_m.beacon_latitude,v_m.beacon_longitude
        );
        if v_distance>250 then raise exception 'MEETUP_BEACON_MISMATCH'; end if;

        update public.meetups set beacon_confirmed_at=now()
        where id=v_m.id returning * into v_m;
        update public.meetup_participants
        set arrival='here',journey_state='here',proximity_observed_at=now()
        where meetup_id=v_m.id and user_id=p_actor_id;
        v_event:='beacon_locked';
      else
        update public.meetup_participants
        set arrival='here',journey_state='here',proximity_observed_at=now()
        where meetup_id=v_m.id and user_id=p_actor_id;
        v_event:='here';
      end if;

    elsif p_action='reset_beacon' then
      if p_actor_id<>v_m.creator_id and p_actor_id is distinct from v_m.host_id then raise exception 'MEETUP_ACCESS'; end if;
      if exists(select 1 from public.meetup_participants p where p.meetup_id=v_m.id and p.met_at is not null) then
        raise exception 'MEETUP_BEACON_LOCKED';
      end if;
      update public.meetups
      set beacon_latitude=null,beacon_longitude=null,beacon_set_by=null,beacon_set_at=null,beacon_confirmed_at=null
      where id=v_m.id returning * into v_m;
      update public.meetup_participants
      set journey_state=case
        when arrival='left' then 'left'
        when arrival='here' then 'waiting'
        when arrival in ('on_my_way','late') then 'on_the_way'
        else 'waiting'
      end,
      arrival=case when arrival='here' then 'not_started' else arrival end,
      proximity_observed_at=null
      where meetup_id=v_m.id;
      v_event:='beacon_reset';

    elsif p_action='cancel' then
      if p_actor_id<>v_m.creator_id and p_actor_id is distinct from v_m.host_id then raise exception 'MEETUP_ACCESS'; end if;
      update public.meetups set status='cancelled' where id=v_m.id returning * into v_m;
      v_event:='cancelled';

    elsif p_action='end' then
      if p_actor_id<>v_m.creator_id then raise exception 'MEETUP_ACCESS'; end if;
      update public.meetups set status='ended' where id=v_m.id returning * into v_m;
      v_event:='ended';

    elsif p_action='home_start' then
      if v_me.response<>'accepted' then raise exception 'MEETUP_ACCEPT_FIRST'; end if;
      if now()<v_m.starts_at-interval '2 hours' then raise exception 'MEETUP_TOO_EARLY'; end if;
      update public.meetup_participants
      set arrival='left',journey_state='left',home_started_at=coalesce(home_started_at,now()),home_arrived_at=null
      where meetup_id=v_m.id and user_id=p_actor_id;
      v_event:='home_started';

      select count(*) into v_accepted from public.meetup_participants where meetup_id=v_m.id and response='accepted';
      select count(*) into v_left from public.meetup_participants where meetup_id=v_m.id and response='accepted' and arrival='left';
      if v_accepted>=2 and v_left=v_accepted then
        update public.meetups set status='ended' where id=v_m.id returning * into v_m;
      end if;

    elsif p_action='home_arrived' then
      if v_me.home_started_at is null or v_me.home_arrived_at is not null then raise exception 'MEETUP_INVALID'; end if;
      update public.meetup_participants
      set home_arrived_at=now()
      where meetup_id=v_m.id and user_id=p_actor_id;
      v_event:='home_arrived';

    elsif p_action in ('arrival','met') then
      if v_me.response<>'accepted'
        or not exists(
          select 1 from public.meetup_participants
          where meetup_id=v_m.id and user_id<>p_actor_id and response='accepted'
        )
        or (
          v_m.host_id is not null
          and not exists(
            select 1 from public.meetup_participants
            where meetup_id=v_m.id and user_id=v_m.host_id and response='accepted'
          )
        ) then raise exception 'MEETUP_ACCEPT_FIRST'; end if;

      if now()<v_m.starts_at-interval '2 hours' then raise exception 'MEETUP_TOO_EARLY'; end if;

      if p_action='met' then
        update public.meetup_participants
        set met_at=coalesce(met_at,now())
        where meetup_id=v_m.id and user_id=p_actor_id;
        if (select count(*) from public.meetup_participants where meetup_id=v_m.id and met_at is not null)>=2 then
          update public.meetups set together_at=coalesce(together_at,now())
          where id=v_m.id returning * into v_m;
        end if;
        v_event:='met';
      else
        v_new:=p_input->>'arrival';
        if v_new not in ('on_my_way','late','here','left') then raise exception 'MEETUP_INVALID'; end if;
        if v_new='late' and coalesce((p_input->>'delayMinutes')::integer,0) not between 1 and 120 then
          raise exception 'MEETUP_INVALID';
        end if;
        if v_new='here' and v_m.beacon_latitude is null then raise exception 'MEETUP_BEACON_REQUIRED'; end if;

        update public.meetup_participants
        set arrival=v_new,
            delay_minutes=case when v_new='late' then (p_input->>'delayMinutes')::integer end,
            journey_state=case
              when v_new='on_my_way' then 'on_the_way'
              when v_new='late' then 'on_the_way'
              when v_new='here' then 'here'
              when v_new='left' then 'left'
              else journey_state
            end,
            proximity_observed_at=case when v_new in ('here','left') then now() else proximity_observed_at end
        where meetup_id=v_m.id and user_id=p_actor_id;

        v_event:=v_new;
        if v_new='late' then v_detail:=jsonb_build_object('delayMinutes',(p_input->>'delayMinutes')::integer); end if;

        if v_new='left' then
          select count(*) into v_accepted from public.meetup_participants where meetup_id=v_m.id and response='accepted';
          select count(*) into v_left from public.meetup_participants where meetup_id=v_m.id and response='accepted' and arrival='left';
          if v_accepted>=2 and v_left=v_accepted then
            update public.meetups set status='ended' where id=v_m.id returning * into v_m;
          end if;
        end if;
      end if;

    else
      raise exception 'MEETUP_INVALID';
    end if;
  end if;

  v_result:=jsonb_build_object('id',v_m.id,'revision',v_m.revision);
  insert into public.meetup_mutations values(v_m.id,p_actor_id,v_key,v_result);

  if v_event not in ('invited') then
    insert into public.meetup_activity(meetup_id,actor_id,event,detail)
      values(v_m.id,p_actor_id,v_event,v_detail);
  end if;

  insert into public.meetup_notification_outbox(meetup_id,recipient_id,sender_id,revision,event,dedupe_key)
    select v_m.id,p.user_id,p_actor_id,v_m.revision,v_event,
      'meetup:'||v_m.id||':'||v_key||':'||p.user_id
    from public.meetup_participants p
    where p.meetup_id=v_m.id
      and p.user_id<>p_actor_id
      and v_event<>'beacon_reset'
      and public.meetup_pair_allowed(p_actor_id,p.user_id)
      and (p.response<>'declined' or v_event in ('cancelled','ended'))
      and (
        v_event in ('invited','rescheduled','place_changed','cancelled','ended','beacon_set','beacon_locked','home_started','home_arrived')
        or p.user_id=v_m.creator_id
        or p.user_id=v_m.host_id
        or (p.response='accepted' and v_event not in ('accepted','declined','suggested'))
      )
    on conflict(dedupe_key) do nothing;

  return v_result;
end $$;

create or replace function public.meetup_notification_allowed(p_id uuid,p_lease_id uuid) returns boolean
language sql stable security invoker set search_path = '' as $$
  select exists(
    select 1
    from public.meetup_notification_outbox o
    join public.meetups m on m.id=o.meetup_id
    join public.meetup_participants p on p.meetup_id=m.id and p.user_id=o.recipient_id
    join public.meetup_participants sender on sender.meetup_id=m.id and sender.user_id=o.sender_id
    where o.id=p_id
      and o.lease_id=p_lease_id
      and o.status='processing'
      and o.revision=m.revision
      and (
        (m.status='active' and o.event not in ('cancelled','ended'))
        or (m.status='cancelled' and o.event='cancelled')
        or (m.status='ended' and o.event in ('ended','home_started','home_arrived'))
      )
      and (p.response<>'declined' or o.event in ('cancelled','ended'))
      and public.meetup_pair_allowed(o.recipient_id,o.sender_id)
      and public.meetup_pair_allowed(o.recipient_id,m.creator_id)
      and (m.host_id is null or public.meetup_pair_allowed(o.recipient_id,m.host_id))
      and case
        when o.event in ('invited','rescheduled') then p.response='invited'
        when o.event='place_changed' then p.response<>'declined'
        when o.event='accepted' then sender.response='accepted'
        when o.event='declined' then sender.response='declined'
        when o.event='suggested' then sender.suggested_start_at>now()
        when o.event in ('on_my_way','late','here','left') then sender.response='accepted' and sender.arrival=o.event and p.response='accepted'
        when o.event='met' then sender.response='accepted' and sender.met_at is not null and p.response='accepted'
        when o.event='beacon_set' then m.beacon_set_at is not null and p.response='accepted'
        when o.event='beacon_locked' then m.beacon_confirmed_at is not null and p.response='accepted'
        when o.event='home_started' then sender.home_started_at is not null and sender.home_arrived_at is null and p.response='accepted'
        when o.event='home_arrived' then sender.home_arrived_at is not null and p.response='accepted'
        when o.event in ('reminder_30','reminder_5','check_outcome') then
          p.response='accepted'
          and p.met_at is null
          and m.status='active'
          and now()<m.expires_at
          and exists(
            select 1 from public.meetup_participants other
            where other.meetup_id=m.id and other.user_id<>p.user_id and other.response='accepted'
          )
          and (
            m.host_id is null
            or exists(
              select 1 from public.meetup_participants host
              where host.meetup_id=m.id and host.user_id=m.host_id and host.response='accepted'
            )
          )
          and case o.event
            when 'reminder_30' then p.arrival not in ('here','left') and now()>=m.starts_at-interval '30 minutes' and now()<m.starts_at-interval '5 minutes'
            when 'reminder_5' then p.arrival not in ('here','left') and now()>=m.starts_at-interval '5 minutes' and now()<m.starts_at
            else now()>=m.starts_at+interval '30 minutes' and now()<m.expires_at
          end
        else o.event in ('cancelled','ended')
      end
  )
$$;

-- Expose the private Meetup Chat only to joined conversation members.
create or replace function public.list_meetups_server(p_actor_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(entry order by starts_at),'[]'::jsonb) from (
    select m.starts_at, jsonb_build_object(
      'id',m.id,'creatorId',m.creator_id,'hostId',m.host_id,'mode',m.mode,
      'placeLabel',m.place_label,'note',m.note,'title',m.title,'category',m.category,
      'sourceDiscoveryId',m.source_discovery_id,
      'conversationId',(
        select c.id
        from public.conversations c
        join public.conversation_members cm on cm.conversation_id=c.id
        where c.context_type='meetup'
          and c.context_id=m.id
          and c.status<>'deleted'
          and cm.user_id=p_actor_id
          and cm.status='joined'
        limit 1
      ),
      'startsAt',m.starts_at,'expiresAt',m.expires_at,
      'timezone',m.timezone,'status',m.status,'revision',m.revision,
      'endedAt',m.ended_at,'endReason',m.end_reason,
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
        or (m.status<>'active' and m.ended_at>now()-interval '24 hours')
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
    where d.deleted_at is null and (
      (d.status='active' and d.listing_expires_at>now() and d.starts_at>now())
      or (d.creator_id=p_actor_id and (d.starts_at>now() or d.updated_at>now()-interval '24 hours'))
      or exists(select 1 from public.meetup_discovery_interests req
        where req.discovery_id=d.id and req.user_id=p_actor_id
          and (d.starts_at>now() or req.updated_at>now()-interval '24 hours'))
    )
      and (
        d.creator_id=p_actor_id
        or public.meetup_discovery_nearby_allowed(p_actor_id,d.creator_id)
        or (exists(select 1 from public.meetup_discovery_interests req where req.discovery_id=d.id and req.user_id=p_actor_id)
          and not exists(select 1 from public.blocked_users b where
            (b.blocker_id=p_actor_id and b.blocked_id=d.creator_id) or (b.blocker_id=d.creator_id and b.blocked_id=p_actor_id)))
      )
    order by d.created_at desc
    limit 300
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
        'meetupStatus',(select ms.status from public.meetups ms where ms.source_discovery_id=d.id),
        'attendeeCount',(select count(*) from public.meetups am join public.meetup_participants ap on ap.meetup_id=am.id
          where am.source_discovery_id=d.id and ap.response in ('accepted','invited')),
        'renewable',d.starts_at>now()+interval '1 minute' and d.refresh_count<2
          and not exists(select 1 from public.meetups rm where rm.source_discovery_id=d.id and
            (rm.status<>'active' or d.meetup_style='one_to_one' or (select count(*) from public.meetup_participants rp where rp.meetup_id=rm.id and rp.response in ('accepted','invited'))>=d.max_attendees)),
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
    'mine',coalesce((select jsonb_agg(item order by created_at desc) from projected where creator_id=p_actor_id),'[]'::jsonb),
    'requests',coalesce((select jsonb_agg(item order by created_at desc) from projected where creator_id<>p_actor_id and item->>'myInterestStatus' is not null),'[]'::jsonb),
    'activeSlots',public.meetup_owner_active_slot_count(p_actor_id),
    'maxActiveSlots',3
  )
$$;


revoke all on function public.stamp_meetup_end(), public.expire_meetup_discoveries_server(),
  public.create_meetup_discovery_server(uuid,jsonb),public.meetup_discovery_command_server(uuid,text,jsonb),
  public.sync_discovery_interest_from_meetup_response(),public.expire_meetups_server(),
  public.meetup_command_server(uuid,text,jsonb),public.meetup_notification_allowed(uuid,uuid),
  public.list_meetup_discoveries_server(uuid),public.meetup_owner_active_slot_count(uuid)
  from public,anon,authenticated;
grant execute on function public.expire_meetup_discoveries_server(),public.create_meetup_discovery_server(uuid,jsonb),
  public.meetup_discovery_command_server(uuid,text,jsonb),public.expire_meetups_server(),
  public.meetup_command_server(uuid,text,jsonb),public.meetup_notification_allowed(uuid,uuid),
  public.list_meetup_discoveries_server(uuid),public.meetup_owner_active_slot_count(uuid) to service_role;

-- Until-start listings follow edits to the scheduled time. Short windows never extend.
create or replace function public.edit_meetup_discovery_server(p_actor_id uuid,p_input jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  v_id uuid := (p_input->>'id')::uuid;
  v_d public.meetup_discoveries;
  v_m public.meetups;
  v_title text := btrim(p_input->>'title');
  v_category text := p_input->>'category';
  v_start timestamptz := (p_input->>'startsAt')::timestamptz;
  v_timezone text := p_input->>'timezone';
  v_key uuid := (p_input->>'requestKey')::uuid;
  v_changed boolean;
  v_time_changed boolean := false;
begin
  if p_actor_id is null or v_id is null or v_key is null then raise exception 'DISCOVERY_INVALID'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_id::text,0));
  select * into v_d from public.meetup_discoveries where id=v_id for update;
  if v_d.id is null or v_d.deleted_at is not null then raise exception 'DISCOVERY_NOT_FOUND'; end if;
  if p_actor_id<>v_d.creator_id then raise exception 'DISCOVERY_ACCESS'; end if;
  if v_d.status<>'active' or v_d.listing_expires_at<=now() or v_d.starts_at<=now() then
    raise exception 'DISCOVERY_CLOSED';
  end if;
  if v_start is null or v_start<=now()+interval '1 minute' then raise exception 'MEETUP_TIME'; end if;
  if v_title is null or char_length(v_title)<2 or char_length(v_title)>40
     or array_length(regexp_split_to_array(v_title,'\s+'),1)>5 then raise exception 'DISCOVERY_TITLE'; end if;
  if v_category is null or v_category not in ('food','study','sports','gym','walk','gaming','chill','anything','coffee','football','drinks','movie','drive','party') then
    raise exception 'DISCOVERY_INVALID';
  end if;
  if not exists(select 1 from pg_catalog.pg_timezone_names where name=v_timezone) then raise exception 'MEETUP_TIME'; end if;

  select * into v_m from public.meetups where source_discovery_id=v_id for update;
  if v_m.id is not null and (v_m.status<>'active' or v_m.starts_at<=now()) then raise exception 'DISCOVERY_CLOSED'; end if;
  v_changed := (v_d.title,v_d.category,v_d.starts_at,v_d.timezone)
    is distinct from (v_title,v_category,v_start,v_timezone);
  if not v_changed then return jsonb_build_object('id',v_id,'changed',false); end if;

  if v_m.id is not null then
    v_time_changed := v_m.starts_at is distinct from v_start;
    if v_time_changed then
      -- Reuse the canonical reschedule flow: reset arrival, ask people to
      -- confirm again, and queue durable notifications instead of silently
      -- changing the time that they originally accepted.
      perform public.meetup_command_server(p_actor_id,'reschedule',jsonb_build_object(
        'id',v_m.id,'revision',v_m.revision,'requestKey',v_key,'startsAt',v_start
      ));
    end if;
    update public.meetups set title=v_title,category=v_category,timezone=v_timezone where id=v_m.id;
    update public.group_settings g set name=v_title
    from public.conversations c
    where g.conversation_id=c.id and c.context_type='meetup' and c.context_id=v_m.id and c.status<>'deleted';
  end if;

  update public.meetup_discoveries set title=v_title,category=v_category,
    starts_at=v_start,timezone=v_timezone,
    listing_expires_at=case when listing_duration_minutes=0 then v_start else least(listing_expires_at,v_start) end,
    updated_at=now() where id=v_id;
  return jsonb_build_object('id',v_id,'changed',true,'timeChanged',v_time_changed,'meetupId',v_m.id);
end $$;

revoke all on function public.edit_meetup_discovery_server(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.edit_meetup_discovery_server(uuid,jsonb) to service_role;
