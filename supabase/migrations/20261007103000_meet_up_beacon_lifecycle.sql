-- Scheduled, temporary Meet Up lifecycle with a server-only Meetup Beacon.
-- Raw beacon coordinates never leave server-side tables/functions. Clients only
-- receive coarse journey states and a beacon status.

alter table public.meetups
  add column if not exists expires_at timestamptz,
  add column if not exists beacon_latitude double precision,
  add column if not exists beacon_longitude double precision,
  add column if not exists beacon_set_by uuid references auth.users(id) on delete set null,
  add column if not exists beacon_set_at timestamptz,
  add column if not exists beacon_confirmed_at timestamptz,
  add column if not exists together_at timestamptz;

update public.meetups
set expires_at = starts_at + interval '6 hours'
where expires_at is null;

alter table public.meetups alter column expires_at set not null;

alter table public.meetup_participants
  add column if not exists journey_state text not null default 'waiting',
  add column if not exists proximity_observed_at timestamptz,
  add column if not exists home_started_at timestamptz,
  add column if not exists home_arrived_at timestamptz;

alter table public.meetup_participants
  drop constraint if exists meetup_participants_journey_state_check;
alter table public.meetup_participants
  add constraint meetup_participants_journey_state_check
  check (journey_state in ('waiting','on_the_way','approaching','nearby','at_spot','here','left'));

-- Existing accepted members have already accepted the Meetup privacy contract.
update public.meetup_participants
set proximity_enabled = true
where response = 'accepted';

create table if not exists public.meetup_activity (
  id uuid primary key default gen_random_uuid(),
  meetup_id uuid not null references public.meetups(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  event text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists meetup_activity_meetup_idx on public.meetup_activity(meetup_id,created_at desc);
alter table public.meetup_activity enable row level security;
revoke all on public.meetup_activity from public,anon,authenticated;
grant all on public.meetup_activity to service_role;

create or replace function public.meetup_distance_m(
  p_lat1 double precision,
  p_lon1 double precision,
  p_lat2 double precision,
  p_lon2 double precision
) returns double precision
language sql immutable security invoker set search_path = '' as $$
  select 6371000.0 * 2.0 * asin(
    least(1.0, sqrt(
      power(sin(radians(p_lat2-p_lat1)/2.0),2)
      + cos(radians(p_lat1))*cos(radians(p_lat2))
      * power(sin(radians(p_lon2-p_lon1)/2.0),2)
    ))
  )
$$;

create or replace function public.expire_meetups_server() returns integer
language plpgsql security invoker set search_path = '' as $$
declare
  v_changed integer := 0;
  v_deleted integer := 0;
begin
  update public.meetups m
  set status='ended'
  where m.status='active'
    and (
      now() >= m.expires_at
      or (
        now() >= m.starts_at + interval '2 hours'
        and not exists (
          select 1 from public.meetup_participants p
          where p.meetup_id=m.id and p.user_id<>m.creator_id and p.response='accepted'
        )
      )
      or (
        (select count(*) from public.meetup_participants p where p.meetup_id=m.id and p.response='accepted') >= 2
        and not exists (
          select 1 from public.meetup_participants p
          where p.meetup_id=m.id and p.response='accepted' and p.arrival<>'left'
        )
      )
    );
  get diagnostics v_changed = row_count;

  delete from public.meetups m
  where m.status in ('ended','cancelled')
    and m.expires_at < now() - interval '24 hours'
    and not exists (
      select 1 from public.meetup_participants p
      where p.meetup_id=m.id and p.home_started_at is not null and p.home_arrived_at is null
    );
  get diagnostics v_deleted = row_count;
  return v_changed + v_deleted;
end $$;

create or replace function public.refresh_meetup_proximity_server(p_actor_id uuid) returns integer
language plpgsql security invoker set search_path = '' as $$
declare
  v_loc record;
  v_row record;
  v_distance double precision;
  v_state text;
  v_updated integer := 0;
begin
  select latitude,longitude,last_updated into v_loc
  from public.user_locations
  where user_id=p_actor_id;

  if not found
    or v_loc.last_updated < now()-interval '2 minutes'
    or v_loc.last_updated > now()+interval '15 seconds' then
    return 0;
  end if;

  for v_row in
    select m.id,m.beacon_latitude,m.beacon_longitude,p.arrival,p.journey_state,p.proximity_observed_at
    from public.meetups m
    join public.meetup_participants p on p.meetup_id=m.id and p.user_id=p_actor_id
    where m.status='active'
      and p.response='accepted'
      and m.beacon_latitude is not null
      and m.beacon_longitude is not null
      and now() >= m.starts_at-interval '2 hours'
      and now() < m.expires_at
  loop
    if v_row.arrival='left' then
      v_state := 'left';
    elsif v_row.arrival='here' then
      v_state := 'here';
    elsif v_row.arrival not in ('on_my_way','late') then
      v_state := 'waiting';
    else
      v_distance := public.meetup_distance_m(
        v_loc.latitude,v_loc.longitude,v_row.beacon_latitude,v_row.beacon_longitude
      );
      v_state := case
        when v_distance <= 80 then 'at_spot'
        when v_distance <= 350 then 'nearby'
        when v_distance <= 1500 then 'approaching'
        else 'on_the_way'
      end;
    end if;

    update public.meetup_participants
    set journey_state=v_state,proximity_observed_at=now()
    where meetup_id=v_row.id and user_id=p_actor_id
      and (
        journey_state is distinct from v_state
        or proximity_observed_at is null
        or proximity_observed_at < now()-interval '60 seconds'
      );
    if found then v_updated := v_updated + 1; end if;
  end loop;

  return v_updated;
end $$;

create or replace function public.list_meetups_server(p_actor_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(entry order by starts_at),'[]'::jsonb) from (
    select m.starts_at, jsonb_build_object(
      'id',m.id,'creatorId',m.creator_id,'hostId',m.host_id,'mode',m.mode,
      'placeLabel',m.place_label,'note',m.note,'startsAt',m.starts_at,'expiresAt',m.expires_at,
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
        or (mine.home_started_at is not null and mine.home_arrived_at is null and m.expires_at>now()-interval '12 hours')
      )
    order by m.starts_at
    limit 100
  ) visible
$$;

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

      v_event:='rescheduled';
      v_detail:=jsonb_build_object('startsAt',v_start);

    elsif p_action='beacon' then
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
        v_event in ('invited','rescheduled','cancelled','ended','beacon_set','beacon_locked','home_started','home_arrived')
        or p.user_id=v_m.creator_id
        or p.user_id=v_m.host_id
        or (p.response='accepted' and v_event not in ('accepted','declined','suggested'))
      )
    on conflict(dedupe_key) do nothing;

  return v_result;
end $$;

create or replace function public.claim_meetup_notifications(p_limit integer default 100) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare v_result jsonb;
begin
  perform public.expire_meetups_server();

  insert into public.meetup_notification_outbox(meetup_id,recipient_id,sender_id,revision,event,dedupe_key)
    select m.id,p.user_id,m.creator_id,m.revision,r.event,
      'meetup:'||m.id||':'||m.revision||':'||r.event||':'||p.user_id
    from public.meetups m
    join public.meetup_participants p on p.meetup_id=m.id
    cross join (values
      ('reminder_30',interval '30 minutes',interval '5 minutes'),
      ('reminder_5',interval '5 minutes',interval '0 minutes'),
      ('check_outcome',interval '-30 minutes',interval '-6 hours')
    ) r(event,early,late)
    where m.status='active'
      and now()<m.expires_at
      and m.starts_at<=now()+interval '30 minutes'
      and p.response='accepted'
      and p.met_at is null
      and (r.event='check_outcome' or p.arrival not in ('here','left'))
      and m.arranged_at<m.starts_at-r.early
      and now()>=m.starts_at-r.early
      and now()<m.starts_at-r.late
      and public.meetup_pair_allowed(p.user_id,m.creator_id)
      and (m.host_id is null or public.meetup_pair_allowed(p.user_id,m.host_id))
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
    on conflict(dedupe_key) do nothing;

  update public.meetup_notification_outbox o
  set status='discarded'
  from public.meetups m
  where o.meetup_id=m.id
    and o.status in ('queued','processing')
    and (
      o.revision<>m.revision
      or (
        m.status<>'active'
        and o.event not in ('cancelled','ended','home_started','home_arrived')
      )
      or not public.meetup_pair_allowed(o.sender_id,o.recipient_id)
    );

  update public.meetup_notification_outbox
  set status='discarded'
  where attempts>=10
    and (status='queued' or (status='processing' and claimed_at<now()-interval '5 minutes'));

  with picked as (
    select id from public.meetup_notification_outbox
    where (status='queued' or (status='processing' and claimed_at<now()-interval '5 minutes'))
      and attempts<10
    order by created_at
    for update skip locked
    limit greatest(1,least(p_limit,200))
  ), claimed as (
    update public.meetup_notification_outbox o
    set status='processing',attempts=attempts+1,claimed_at=now(),lease_id=gen_random_uuid()
    from picked where o.id=picked.id returning o.*
  )
  select coalesce(jsonb_agg(to_jsonb(claimed)),'[]'::jsonb)
  into v_result from claimed;

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

-- Private, payload-minimal Realtime invalidation. The browser never receives
-- meetup rows or raw beacon coordinates; it only gets a "changed" signal and
-- refetches the canonical server projection.
create or replace function public.meetup_realtime_allowed(p_topic text) returns boolean
language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null
    and split_part(p_topic,':',1)='meetup'
    and exists(
      select 1 from public.meetup_participants p
      where p.user_id=(select auth.uid())
        and p.meetup_id::text=split_part(p_topic,':',2)
    )
$$;
revoke all on function public.meetup_realtime_allowed(text) from public,anon,authenticated;
grant execute on function public.meetup_realtime_allowed(text) to authenticated;

drop policy if exists "meetup participants can receive broadcasts" on realtime.messages;
create policy "meetup participants can receive broadcasts"
on realtime.messages
for select
to authenticated
using (
  realtime.messages.extension='broadcast'
  and public.meetup_realtime_allowed((select realtime.topic()))
);

create or replace function public.broadcast_meetup_row_change() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare v_id uuid;
begin
  v_id:=case when tg_op='DELETE' then old.id else new.id end;
  perform realtime.send(jsonb_build_object('meetupId',v_id),'changed','meetup:'||v_id::text,true);
  return case when tg_op='DELETE' then old else new end;
end $$;

create or replace function public.broadcast_meetup_participant_change() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare v_id uuid;
begin
  v_id:=case when tg_op='DELETE' then old.meetup_id else new.meetup_id end;
  perform realtime.send(jsonb_build_object('meetupId',v_id),'changed','meetup:'||v_id::text,true);
  return case when tg_op='DELETE' then old else new end;
end $$;

drop trigger if exists meetups_broadcast_change on public.meetups;
create trigger meetups_broadcast_change
after insert or update or delete on public.meetups
for each row execute function public.broadcast_meetup_row_change();

drop trigger if exists meetup_participants_broadcast_change on public.meetup_participants;
create trigger meetup_participants_broadcast_change
after insert or update or delete on public.meetup_participants
for each row execute function public.broadcast_meetup_participant_change();

revoke all on function public.meetup_distance_m(double precision,double precision,double precision,double precision),
  public.expire_meetups_server(),
  public.refresh_meetup_proximity_server(uuid),
  public.broadcast_meetup_row_change(),
  public.broadcast_meetup_participant_change()
from public,anon,authenticated;

grant execute on function public.meetup_distance_m(double precision,double precision,double precision,double precision),
  public.expire_meetups_server(),
  public.refresh_meetup_proximity_server(uuid),
  public.broadcast_meetup_row_change(),
  public.broadcast_meetup_participant_change()
to service_role;

-- Re-assert service-only command/list access after replacing the functions.
revoke all on function public.list_meetups_server(uuid),
  public.meetup_command_server(uuid,text,jsonb),
  public.claim_meetup_notifications(integer),
  public.meetup_notification_allowed(uuid,uuid)
from public,anon,authenticated;

grant execute on function public.list_meetups_server(uuid),
  public.meetup_command_server(uuid,text,jsonb),
  public.claim_meetup_notifications(integer),
  public.meetup_notification_allowed(uuid,uuid)
to service_role;
