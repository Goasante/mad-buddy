-- Meet New People: Meetup-native nearby discovery that can replace UpFor.

create table if not exists public.meetup_discoveries (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (
    char_length(btrim(title)) between 2 and 40
    and array_length(regexp_split_to_array(btrim(title), '\s+'), 1) between 1 and 5
  ),
  category text not null default 'anything' check (
    category in ('food','study','sports','gym','walk','gaming','chill','anything','coffee','football','drinks','movie','drive','party')
  ),
  meetup_style text not null check (meetup_style in ('one_to_one','group')),
  starts_at timestamptz not null,
  timezone text not null,
  listing_duration_minutes integer not null check (listing_duration_minutes in (30,60,120,240)),
  listing_expires_at timestamptz not null,
  status text not null default 'active' check (status in ('active','matched','expired','cancelled')),
  max_attendees integer not null check (max_attendees between 2 and 6),
  interest_limit integer not null default 6 check (interest_limit = 6),
  refresh_count integer not null default 0 check (refresh_count between 0 and 2),
  request_key uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(creator_id, request_key)
);

create table if not exists public.meetup_discovery_interests (
  discovery_id uuid not null references public.meetup_discoveries(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','declined','withdrawn')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(discovery_id,user_id)
);

create index if not exists meetup_discoveries_active_idx
  on public.meetup_discoveries(status, listing_expires_at, starts_at);
create index if not exists meetup_discoveries_creator_idx
  on public.meetup_discoveries(creator_id, status, listing_expires_at);
create index if not exists meetup_discovery_interests_status_idx
  on public.meetup_discovery_interests(discovery_id,status);

alter table public.meetup_discoveries enable row level security;
alter table public.meetup_discovery_interests enable row level security;
revoke all on public.meetup_discoveries, public.meetup_discovery_interests from public,anon,authenticated;
grant all on public.meetup_discoveries, public.meetup_discovery_interests to service_role;

alter table public.meetups
  add column if not exists source_discovery_id uuid references public.meetup_discoveries(id) on delete set null,
  add column if not exists title text,
  add column if not exists category text not null default 'anything';

alter table public.meetups drop constraint if exists meetups_category_check;
alter table public.meetups add constraint meetups_category_check check (
  category in ('food','study','sports','gym','walk','gaming','chill','anything','coffee','football','drinks','movie','drive','party')
);
create unique index if not exists meetups_source_discovery_unique
  on public.meetups(source_discovery_id) where source_discovery_id is not null;

alter table public.conversations drop constraint if exists conversations_context_type_check;
alter table public.conversations add constraint conversations_context_type_check
  check (context_type in ('plan','event','event_circle','safe_arrival','ping','wave','meetup'));
create unique index if not exists conversations_meetup_context_unique
  on public.conversations(context_type,context_id)
  where context_type='meetup' and context_id is not null and status<>'deleted';

create or replace function public.meetup_owner_active_slot_count(p_actor_id uuid) returns integer
language sql stable security invoker set search_path='' as $$
  select
    (select count(*)::integer
       from public.meetups m
      where m.creator_id=p_actor_id
        and m.status='active'
        and now()<m.expires_at)
    +
    (select count(*)::integer
       from public.meetup_discoveries d
      where d.creator_id=p_actor_id
        and d.status='active'
        and now()<d.listing_expires_at
        and not exists(
          select 1 from public.meetups m where m.source_discovery_id=d.id and m.status='active'
        ));
$$;

create or replace function public.enforce_meetup_owner_slot_limit() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if public.meetup_owner_active_slot_count(new.creator_id) > 3 then
    raise exception 'MEETUP_LIMIT';
  end if;
  return new;
end $$;

drop trigger if exists meetups_owner_slot_limit on public.meetups;
create trigger meetups_owner_slot_limit
after insert on public.meetups
for each row execute function public.enforce_meetup_owner_slot_limit();

create or replace function public.meetup_discovery_nearby_allowed(p_viewer uuid,p_creator uuid) returns boolean
language sql stable security invoker set search_path='' as $$
  select
    p_viewer<>p_creator
    and not exists(
      select 1 from public.blocked_users b
      where (b.blocker_id=p_viewer and b.blocked_id=p_creator)
         or (b.blocker_id=p_creator and b.blocked_id=p_viewer)
    )
    and coalesce((select pr.visibility_status::text='visible' from public.profiles pr where pr.user_id=p_creator),false)
    and exists(
      select 1
      from public.user_locations v
      join public.user_locations c on c.user_id=p_creator
      where v.user_id=p_viewer
        and v.last_updated>now()-interval '60 minutes'
        and c.last_updated>now()-interval '60 minutes'
        and public.meetup_distance_m(v.latitude,v.longitude,c.latitude,c.longitude)<=15000
    );
$$;

create or replace function public.meetup_pair_allowed(p_a uuid,p_b uuid) returns boolean
language sql stable security invoker set search_path='' as $$
  select p_a=p_b or (
    not exists(select 1 from public.blocked_users b where
      (b.blocker_id=p_a and b.blocked_id=p_b) or (b.blocker_id=p_b and b.blocked_id=p_a))
    and (
      exists(select 1 from public.friendships f where f.ended_at is null and
        ((f.user_one_id=p_a and f.user_two_id=p_b) or (f.user_one_id=p_b and f.user_two_id=p_a)))
      or exists(
        select 1
        from public.meetups m
        join public.meetup_participants pa on pa.meetup_id=m.id and pa.user_id=p_a and pa.response='accepted'
        join public.meetup_participants pb on pb.meetup_id=m.id and pb.user_id=p_b and pb.response='accepted'
        where m.source_discovery_id is not null
      )
    )
  );
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
  where d.status='active' and d.listing_expires_at<=now();
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
  if v_duration not in (30,60,120,240) then raise exception 'DISCOVERY_INVALID'; end if;
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
    v_duration,now()+make_interval(mins=>v_duration),
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
  if v_d.id is null then raise exception 'DISCOVERY_NOT_FOUND'; end if;

  if p_action='interest' then
    if v_d.status<>'active' or v_d.listing_expires_at<=now() then raise exception 'DISCOVERY_CLOSED'; end if;
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
          when meetup_style='one_to_one' or v_count>=max_attendees-1 then 'matched'
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

      update public.meetup_discoveries d
        set status='active',updated_at=now()
        where d.id=v_discovery
          and d.meetup_style='group'
          and d.listing_expires_at>now()
          and (select count(*) from public.meetup_participants p
               where p.meetup_id=new.meetup_id and p.response='accepted')<d.max_attendees;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists meetup_discovery_participant_response_sync on public.meetup_participants;
create trigger meetup_discovery_participant_response_sync
after update of response on public.meetup_participants
for each row execute function public.sync_discovery_interest_from_meetup_response();

revoke all on function public.meetup_owner_active_slot_count(uuid),
  public.meetup_discovery_nearby_allowed(uuid,uuid),
  public.expire_meetup_discoveries_server(),
  public.create_meetup_discovery_server(uuid,jsonb),
  public.meetup_discovery_command_server(uuid,text,jsonb),
  public.enforce_meetup_owner_slot_limit(),
  public.sync_discovery_interest_from_meetup_response()
from public,anon,authenticated;

grant execute on function public.meetup_owner_active_slot_count(uuid),
  public.meetup_discovery_nearby_allowed(uuid,uuid),
  public.expire_meetup_discoveries_server(),
  public.create_meetup_discovery_server(uuid,jsonb),
  public.meetup_discovery_command_server(uuid,text,jsonb)
to service_role;
