-- Meet Up is separate from Plans and UpFor. No coordinates or movement history.
-- Only the authenticated application server can invoke these functions.
create table public.meetups (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references auth.users(id) on delete cascade,
  host_id uuid references auth.users(id) on delete cascade,
  mode text not null check (mode in ('come_over','coming_to','meet_somewhere')),
  place_label text not null check (length(btrim(place_label)) between 1 and 120),
  note text not null default '' check (length(note) <= 200),
  starts_at timestamptz not null,
  timezone text not null,
  status text not null default 'active' check (status in ('active','cancelled','ended')),
  revision integer not null default 1,
  request_key uuid not null,
  created_at timestamptz not null default now(),
  arranged_at timestamptz not null default now(),
  unique (creator_id, request_key),
  check ((mode = 'meet_somewhere' and host_id is null) or (mode <> 'meet_somewhere' and host_id is not null))
);
create table public.meetup_participants (
  meetup_id uuid not null references public.meetups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  response text not null default 'invited' check (response in ('invited','accepted','declined')),
  arrival text not null default 'not_started' check (arrival in ('not_started','on_my_way','late','here','left')),
  delay_minutes integer check (delay_minutes between 1 and 120),
  met_at timestamptz,
  suggested_start_at timestamptz,
  proximity_enabled boolean not null default false,
  primary key (meetup_id,user_id)
);
create index meetup_participants_user_idx on public.meetup_participants(user_id,meetup_id);
create index meetups_creator_idx on public.meetups(creator_id,status,starts_at);
create index meetups_active_starts_idx on public.meetups(starts_at) where status='active';
create table public.meetup_mutations (
  meetup_id uuid not null references public.meetups(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete cascade,
  request_key uuid not null,
  result jsonb not null,
  primary key (meetup_id,actor_id,request_key)
);
create table public.meetup_notification_outbox (
  id uuid primary key default gen_random_uuid(),
  meetup_id uuid not null references public.meetups(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  revision integer not null,
  event text not null,
  dedupe_key text not null unique,
  status text not null default 'queued' check (status in ('queued','processing','sent','discarded')),
  attempts integer not null default 0,
  lease_id uuid,
  claimed_at timestamptz,
  created_at timestamptz not null default now()
);
create index meetup_outbox_pending_idx on public.meetup_notification_outbox(created_at) where status in ('queued','processing');
alter table public.meetups enable row level security;
alter table public.meetup_participants enable row level security;
alter table public.meetup_mutations enable row level security;
alter table public.meetup_notification_outbox enable row level security;
revoke all on public.meetups, public.meetup_participants, public.meetup_mutations, public.meetup_notification_outbox from public,anon,authenticated;
grant all on public.meetups, public.meetup_participants, public.meetup_mutations, public.meetup_notification_outbox to service_role;

create function public.meetup_pair_allowed(p_a uuid,p_b uuid) returns boolean
language sql stable security invoker set search_path = '' as $$
  select p_a = p_b or (
    exists(select 1 from public.friendships f where f.ended_at is null and
      ((f.user_one_id=p_a and f.user_two_id=p_b) or (f.user_one_id=p_b and f.user_two_id=p_a)))
    and not exists(select 1 from public.blocked_users b where
      (b.blocker_id=p_a and b.blocked_id=p_b) or (b.blocker_id=p_b and b.blocked_id=p_a))
  )
$$;

create function public.list_meetups_server(p_actor_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(entry order by starts_at),'[]'::jsonb) from (
    select m.starts_at, jsonb_build_object(
      'id',m.id,'creatorId',m.creator_id,'hostId',m.host_id,'mode',m.mode,
      'placeLabel',m.place_label,'note',m.note,'startsAt',m.starts_at,'timezone',m.timezone,
      'status',m.status,'revision',m.revision,
      'members',(select coalesce(jsonb_agg(jsonb_build_object(
        'key',md5(p.user_id::text || m.id::text),
        'userId',case when public.meetup_pair_allowed(p_actor_id,p.user_id) then p.user_id end,
        'name',case when public.meetup_pair_allowed(p_actor_id,p.user_id) then coalesce(pr.full_name,'A Muddy') else 'Another Muddy' end,
        'response',p.response,'arrival',p.arrival,'delayMinutes',p.delay_minutes,
        'metAt',p.met_at,'proximityEnabled',p.proximity_enabled,
        'suggestedStartAt',case when p_actor_id=m.creator_id or p_actor_id=p.user_id then p.suggested_start_at end
      ) order by p.user_id),'[]'::jsonb)
      from public.meetup_participants p left join public.profiles pr on pr.user_id=p.user_id where p.meetup_id=m.id)
    ) entry
    from public.meetups m join public.meetup_participants mine on mine.meetup_id=m.id and mine.user_id=p_actor_id
    where public.meetup_pair_allowed(p_actor_id,m.creator_id)
      and (m.host_id is null or public.meetup_pair_allowed(p_actor_id,m.host_id))
      and m.starts_at > now()-interval '7 days'
    order by case when m.status='active' then 0 else 1 end,m.starts_at limit 100
  ) visible
$$;

create function public.meetup_command_server(p_actor_id uuid,p_action text,p_input jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_id uuid; v_key uuid := (p_input->>'requestKey')::uuid;
  v_m public.meetups; v_me public.meetup_participants; v_ids uuid[]; v_other uuid;
  v_start timestamptz; v_host uuid; v_result jsonb; v_event text; v_new text;
begin
  if p_actor_id is null or v_key is null then raise exception 'MEETUP_INVALID'; end if;
  if p_action='create' then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_actor_id::text,0));
    select id into v_id from public.meetups where creator_id=p_actor_id and request_key=v_key;
    if v_id is not null then return jsonb_build_object('id',v_id); end if;
    if (select count(*) from public.meetups where creator_id=p_actor_id and status='active' and starts_at>now()-interval '2 hours')>=20 then
      raise exception 'MEETUP_LIMIT';
    end if;
    select array_agg(distinct value::uuid) into v_ids from jsonb_array_elements_text(p_input->'participantIds');
    if coalesce(cardinality(v_ids),0)<1 or cardinality(v_ids)>49 or p_actor_id=any(v_ids) then raise exception 'MEETUP_INVALID'; end if;
    foreach v_other in array v_ids loop
      if not public.meetup_pair_allowed(p_actor_id,v_other) then raise exception 'MEETUP_NOT_MUDDIES'; end if;
    end loop;
    if p_input->>'mode'='coming_to' and cardinality(v_ids)<>1 then raise exception 'MEETUP_INVALID'; end if;
    v_host := case p_input->>'mode' when 'come_over' then p_actor_id when 'coming_to' then v_ids[1] end;
    v_start := case when p_input->>'when'='now' then now() else (p_input->>'startsAt')::timestamptz end;
    if v_start is null or (p_input->>'when'<>'now' and v_start<=now()) then raise exception 'MEETUP_TIME'; end if;
    if not exists(select 1 from pg_catalog.pg_timezone_names where name=p_input->>'timezone') then raise exception 'MEETUP_TIME'; end if;
    insert into public.meetups(creator_id,host_id,mode,place_label,note,starts_at,timezone,request_key)
      values(p_actor_id,v_host,p_input->>'mode',btrim(p_input->>'placeLabel'),coalesce(p_input->>'note',''),v_start,p_input->>'timezone',v_key)
      returning * into v_m;
    insert into public.meetup_participants(meetup_id,user_id,response) values(v_m.id,p_actor_id,'accepted');
    insert into public.meetup_participants(meetup_id,user_id) select v_m.id,unnest(v_ids);
    v_event := 'invited';
  else
    select * into v_m from public.meetups where id=(p_input->>'id')::uuid for update;
    if v_m.id is null then raise exception 'MEETUP_NOT_FOUND'; end if;
    select * into v_me from public.meetup_participants where meetup_id=v_m.id and user_id=p_actor_id;
    if v_me.user_id is null or not public.meetup_pair_allowed(p_actor_id,v_m.creator_id)
      or (v_m.host_id is not null and not public.meetup_pair_allowed(p_actor_id,v_m.host_id)) then raise exception 'MEETUP_ACCESS'; end if;
    select result into v_result from public.meetup_mutations where meetup_id=v_m.id and actor_id=p_actor_id and request_key=v_key;
    if v_result is not null then return v_result; end if;
    if (p_input->>'revision') is null or v_m.revision<>(p_input->>'revision')::integer then raise exception 'MEETUP_CHANGED'; end if;
    if v_m.status<>'active' then raise exception 'MEETUP_ENDED'; end if;
    if p_action='respond' then
      v_new := p_input->>'response';
      if v_new not in ('accepted','declined') or p_actor_id=v_m.creator_id then raise exception 'MEETUP_INVALID'; end if;
      update public.meetup_participants set response=v_new,arrival='not_started',delay_minutes=null,met_at=null,suggested_start_at=null,proximity_enabled=false where meetup_id=v_m.id and user_id=p_actor_id;
      if v_new='declined' and p_actor_id=v_m.host_id then
        update public.meetups set status='cancelled' where id=v_m.id returning * into v_m;
        v_event:='cancelled';
      else v_event:=v_new; end if;
    elsif p_action='suggest' then
      v_start:=(p_input->>'startsAt')::timestamptz;
      if v_start is null or v_start<=now() then raise exception 'MEETUP_TIME'; end if;
      update public.meetup_participants set suggested_start_at=v_start where meetup_id=v_m.id and user_id=p_actor_id;
      v_event:='suggested';
    elsif p_action='reschedule' then
      if p_actor_id<>v_m.creator_id then raise exception 'MEETUP_ACCESS'; end if;
      v_start:=(p_input->>'startsAt')::timestamptz;
      if v_start is null or v_start<=now() then raise exception 'MEETUP_TIME'; end if;
      update public.meetups set starts_at=v_start,arranged_at=now(),revision=revision+1 where id=v_m.id returning * into v_m;
      update public.meetup_participants set response=case when user_id=p_actor_id then 'accepted' else 'invited' end,
        arrival='not_started',delay_minutes=null,met_at=null,suggested_start_at=null,proximity_enabled=false where meetup_id=v_m.id and response<>'declined';
      v_event:='rescheduled';
    elsif p_action='cancel' then
      if p_actor_id<>v_m.creator_id and p_actor_id is distinct from v_m.host_id then raise exception 'MEETUP_ACCESS'; end if;
      update public.meetups set status='cancelled' where id=v_m.id returning * into v_m; v_event:='cancelled';
    elsif p_action='end' then
      if p_actor_id<>v_m.creator_id then raise exception 'MEETUP_ACCESS'; end if;
      update public.meetups set status='ended' where id=v_m.id returning * into v_m; v_event:='ended';
    elsif p_action='proximity' then
      if v_me.response<>'accepted' or (p_input->>'enabled') is null then raise exception 'MEETUP_ACCEPT_FIRST'; end if;
      update public.meetup_participants set proximity_enabled=(p_input->>'enabled')::boolean where meetup_id=v_m.id and user_id=p_actor_id;
      v_event:='proximity';
    elsif p_action in ('arrival','met') then
      if v_me.response<>'accepted' or not exists(select 1 from public.meetup_participants where meetup_id=v_m.id and user_id<>p_actor_id and response='accepted')
        or (v_m.host_id is not null and not exists(select 1 from public.meetup_participants where meetup_id=v_m.id and user_id=v_m.host_id and response='accepted')) then raise exception 'MEETUP_ACCEPT_FIRST'; end if;
      if now()<v_m.starts_at-interval '2 hours' then raise exception 'MEETUP_TOO_EARLY'; end if;
      if p_action='met' then
        update public.meetup_participants set met_at=coalesce(met_at,now()) where meetup_id=v_m.id and user_id=p_actor_id; v_event:='met';
      else
        v_new:=p_input->>'arrival';
        if v_new not in ('on_my_way','late','here','left') then raise exception 'MEETUP_INVALID'; end if;
        if v_new='late' and (coalesce((p_input->>'delayMinutes')::integer,0) not between 1 and 120) then raise exception 'MEETUP_INVALID'; end if;
        update public.meetup_participants set arrival=v_new,delay_minutes=case when v_new='late' then (p_input->>'delayMinutes')::integer end where meetup_id=v_m.id and user_id=p_actor_id;
        v_event:=v_new;
      end if;
    else raise exception 'MEETUP_INVALID'; end if;
  end if;
  v_result:=jsonb_build_object('id',v_m.id,'revision',v_m.revision);
  insert into public.meetup_mutations values(v_m.id,p_actor_id,v_key,v_result);
  insert into public.meetup_notification_outbox(meetup_id,recipient_id,sender_id,revision,event,dedupe_key)
    select v_m.id,p.user_id,p_actor_id,v_m.revision,v_event,
      'meetup:'||v_m.id||':'||v_key||':'||p.user_id
    from public.meetup_participants p where p.meetup_id=v_m.id and p.user_id<>p_actor_id and v_event<>'proximity'
      and public.meetup_pair_allowed(p_actor_id,p.user_id)
      and (p.response<>'declined' or v_event='cancelled')
      and (v_event in ('invited','rescheduled','cancelled','ended')
        or p.user_id=v_m.creator_id or p.user_id=v_m.host_id or (p.response='accepted' and v_event not in ('accepted','declined','suggested')))
    on conflict(dedupe_key) do nothing;
  return v_result;
end $$;

create function public.claim_meetup_notifications(p_limit integer default 100) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare v_result jsonb;
begin
  -- Scheduled reminders are durable and independent of whether the app is open.
  insert into public.meetup_notification_outbox(meetup_id,recipient_id,sender_id,revision,event,dedupe_key)
    select m.id,p.user_id,m.creator_id,m.revision,r.event,
      'meetup:'||m.id||':'||m.revision||':'||r.event||':'||p.user_id
    from public.meetups m join public.meetup_participants p on p.meetup_id=m.id
    cross join (values ('reminder_30',interval '30 minutes',interval '5 minutes'),
      ('reminder_5',interval '5 minutes',interval '0 minutes'),
      ('check_outcome',interval '-30 minutes',interval '-7 days')) r(event,early,late)
    where m.status='active' and m.starts_at>now()-interval '7 days' and m.starts_at<=now()+interval '30 minutes'
      and p.response='accepted' and p.met_at is null
      and (r.event='check_outcome' or p.arrival not in ('here','left'))
      and m.arranged_at<m.starts_at-r.early
      and now()>=m.starts_at-r.early and now()<m.starts_at-r.late
      and public.meetup_pair_allowed(p.user_id,m.creator_id)
      and (m.host_id is null or public.meetup_pair_allowed(p.user_id,m.host_id))
      and exists(select 1 from public.meetup_participants other where other.meetup_id=m.id and other.user_id<>p.user_id and other.response='accepted')
      and (m.host_id is null or exists(select 1 from public.meetup_participants host where host.meetup_id=m.id and host.user_id=m.host_id and host.response='accepted'))
    on conflict(dedupe_key) do nothing;
  update public.meetup_notification_outbox o set status='discarded' from public.meetups m
    where o.meetup_id=m.id and o.status in ('queued','processing') and
      (o.revision<>m.revision or (m.status<>'active' and o.event not in ('cancelled','ended'))
       or not public.meetup_pair_allowed(o.sender_id,o.recipient_id));
  update public.meetup_notification_outbox set status='discarded'
    where attempts>=10 and (status='queued' or (status='processing' and claimed_at<now()-interval '5 minutes'));
  with picked as (
    select id from public.meetup_notification_outbox where
      (status='queued' or (status='processing' and claimed_at<now()-interval '5 minutes')) and attempts<10
    order by created_at for update skip locked limit greatest(1,least(p_limit,200))
  ), claimed as (
    update public.meetup_notification_outbox o set status='processing',attempts=attempts+1,claimed_at=now(),lease_id=gen_random_uuid()
    from picked where o.id=picked.id returning o.*
  ) select coalesce(jsonb_agg(to_jsonb(claimed)),'[]'::jsonb) into v_result from claimed;
  return v_result;
end $$;

create function public.meetup_notification_allowed(p_id uuid,p_lease_id uuid) returns boolean
language sql stable security invoker set search_path = '' as $$
  select exists(select 1 from public.meetup_notification_outbox o
    join public.meetups m on m.id=o.meetup_id
    join public.meetup_participants p on p.meetup_id=m.id and p.user_id=o.recipient_id
    join public.meetup_participants sender on sender.meetup_id=m.id and sender.user_id=o.sender_id
    where o.id=p_id and o.lease_id=p_lease_id and o.status='processing' and o.revision=m.revision
      and ((m.status='active' and o.event not in ('cancelled','ended'))
        or (m.status='cancelled' and o.event='cancelled') or (m.status='ended' and o.event='ended'))
      and (p.response<>'declined' or o.event in ('cancelled','ended'))
      and public.meetup_pair_allowed(o.recipient_id,o.sender_id)
      and public.meetup_pair_allowed(o.recipient_id,m.creator_id)
      and (m.host_id is null or public.meetup_pair_allowed(o.recipient_id,m.host_id))
      -- Claimed work can become stale before delivery. Check the current state,
      -- not only membership: an accepted invitation or old reminder must not send.
      and case
        when o.event in ('invited','rescheduled') then p.response='invited'
        when o.event='accepted' then sender.response='accepted'
        when o.event='declined' then sender.response='declined'
        when o.event='suggested' then sender.suggested_start_at>now()
        when o.event in ('on_my_way','late','here','left') then sender.response='accepted' and sender.arrival=o.event and p.response='accepted'
        when o.event='met' then sender.response='accepted' and sender.met_at is not null and p.response='accepted'
        when o.event in ('reminder_30','reminder_5','check_outcome') then
          p.response='accepted' and p.met_at is null
          and exists(select 1 from public.meetup_participants other where other.meetup_id=m.id and other.user_id<>p.user_id and other.response='accepted')
          and (m.host_id is null or exists(select 1 from public.meetup_participants host where host.meetup_id=m.id and host.user_id=m.host_id and host.response='accepted'))
          and case o.event
            when 'reminder_30' then p.arrival not in ('here','left') and now()>=m.starts_at-interval '30 minutes' and now()<m.starts_at-interval '5 minutes'
            when 'reminder_5' then p.arrival not in ('here','left') and now()>=m.starts_at-interval '5 minutes' and now()<m.starts_at
            else now()>=m.starts_at+interval '30 minutes' and now()<m.starts_at+interval '7 days'
          end
        else o.event in ('cancelled','ended')
      end)
$$;

create function public.finish_meetup_notification(p_id uuid,p_lease_id uuid,p_sent boolean) returns boolean
language plpgsql security invoker set search_path = '' as $$
begin
  update public.meetup_notification_outbox set status=case when p_sent then 'sent' else 'queued' end
    where id=p_id and lease_id=p_lease_id and status='processing';
  return found;
end $$;

revoke all on function public.meetup_pair_allowed(uuid,uuid), public.list_meetups_server(uuid),
  public.meetup_command_server(uuid,text,jsonb),public.claim_meetup_notifications(integer),
  public.meetup_notification_allowed(uuid,uuid),
  public.finish_meetup_notification(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.meetup_pair_allowed(uuid,uuid), public.list_meetups_server(uuid),
  public.meetup_command_server(uuid,text,jsonb),public.claim_meetup_notifications(integer),
  public.meetup_notification_allowed(uuid,uuid),
  public.finish_meetup_notification(uuid,uuid,boolean) to service_role;
