-- Staging integration proof; every fixture and side effect rolls back.
begin;
do $$
declare
  actor uuid; peer uuid; outsider uuid; d uuid; m uuid; gd uuid; gm uuid;
  result jsonb; hub jsonb; seen boolean; i integer; rev integer; retry uuid; count_before integer;
begin
  select user_id into actor from public.profiles order by user_id limit 1;
  select user_id into peer from public.profiles where user_id<>actor order by user_id limit 1;
  select user_id into outsider from public.profiles where user_id not in (actor,peer) order by user_id limit 1;
  if outsider is null then raise exception 'PROOF_REQUIRES_THREE_PROFILES'; end if;
  update public.profiles set visibility_status='visible' where user_id in (actor,peer);
  insert into public.user_locations(user_id,latitude,longitude,accuracy,confidence,last_updated)
    values(actor,5.6,-0.2,10,'high',now()),(peer,5.6,-0.2,10,'high',now())
    on conflict(user_id) do update set latitude=excluded.latitude,longitude=excluded.longitude,
      accuracy=10,confidence='high',last_updated=now();
  -- Existing staging fixtures are isolated inside the transaction.
  update public.meetup_discoveries set status='cancelled' where creator_id=actor;

  result:=public.create_meetup_discovery_server(actor,jsonb_build_object('title','Coffee proof','category','coffee','style','one_to_one',
    'startsAt',now()+interval '1 hour','timezone','UTC','durationMinutes',0,'requestKey',gen_random_uuid()));
  d:=(result->>'id')::uuid;
  if not exists(select 1 from public.meetup_discoveries where id=d and listing_expires_at=starts_at) then raise exception 'UNTIL_START_EXPIRY_WRONG'; end if;
  perform public.edit_meetup_discovery_server(actor,jsonb_build_object('id',d,'title','Coffee proof','category','coffee','startsAt',now()+interval '90 minutes','timezone','UTC','requestKey',gen_random_uuid()));
  if not exists(select 1 from public.meetup_discoveries where id=d and listing_expires_at=starts_at and starts_at=now()+interval '90 minutes') then raise exception 'UNTIL_START_EDIT_EXPIRY_WRONG'; end if;
  perform public.meetup_discovery_command_server(peer,'interest',jsonb_build_object('id',d));
  update public.meetup_discoveries set listing_expires_at=now()-interval '1 minute' where id=d;
  perform public.expire_meetup_discoveries_server();
  hub:=public.list_meetup_discoveries_server(actor);
  if not exists(select 1 from jsonb_array_elements(hub->'mine') x where x->>'id'=d::text and jsonb_array_length(x->'interestedPeople')=1) then raise exception 'EXPIRED_INTEREST_LOST'; end if;
  update public.user_locations set latitude=0,longitude=0 where user_id=peer;
  hub:=public.list_meetup_discoveries_server(peer);
  if not exists(select 1 from jsonb_array_elements(hub->'requests') x where x->>'id'=d::text) then raise exception 'REQUEST_RECEIPT_LOST_AFTER_MOVING'; end if;
  update public.user_locations set latitude=5.6,longitude=-0.2 where user_id=peer;
  result:=public.meetup_discovery_command_server(actor,'decide',jsonb_build_object('id',d,'userId',peer,'response','accepted'));
  m:=(result->>'meetupId')::uuid;
  if m is null or public.meetup_owner_active_slot_count(actor)<>0 then raise exception 'EXPIRED_MATCH_USES_SLOT'; end if;
  if not exists(select 1 from jsonb_array_elements(public.list_meetups_server(peer)) x where x->>'id'=m::text and x->>'conversationId' is not null) then raise exception 'MATCH_CHAT_MISSING'; end if;

  retry:=gen_random_uuid();
  perform public.meetup_command_server(actor,'place',jsonb_build_object('id',m,'revision',1,'requestKey',retry,'placeLabel','Agreed café'));
  perform public.meetup_command_server(actor,'place',jsonb_build_object('id',m,'revision',1,'requestKey',retry,'placeLabel','Agreed café'));
  select revision into rev from public.meetups where id=m;
  if rev<>2 or not exists(select 1 from public.meetups where id=m and place_label='Agreed café') then raise exception 'PLACE_SAVE_NOT_IDEMPOTENT'; end if;
  if not exists(select 1 from public.meetup_notification_outbox where meetup_id=m and event='place_changed' and recipient_id=peer) then raise exception 'PLACE_NOTIFICATION_MISSING'; end if;
  begin
    perform public.meetup_command_server(peer,'place',jsonb_build_object('id',m,'revision',rev,'requestKey',gen_random_uuid(),'placeLabel','Wrong place'));
    raise exception 'NON_OWNER_EDITED_PLACE';
  exception when others then if sqlerrm<>'MEETUP_ACCESS' then raise; end if; end;
  begin
    perform public.meetup_command_server(outsider,'place',jsonb_build_object('id',m,'revision',rev,'requestKey',gen_random_uuid(),'placeLabel','Wrong place'));
    raise exception 'OUTSIDER_EDITED_PLACE';
  exception when others then if sqlerrm<>'MEETUP_ACCESS' then raise; end if; end;
  perform public.meetup_command_server(actor,'beacon',jsonb_build_object('id',m,'revision',rev,'requestKey',gen_random_uuid()));
  perform public.meetup_command_server(peer,'beacon',jsonb_build_object('id',m,'revision',rev,'requestKey',gen_random_uuid()));
  if (select count(*) from public.meetup_participants where meetup_id=m and arrival='here')<>2 then raise exception 'SIMPLE_ARRIVAL_BROKEN'; end if;
  perform public.meetup_command_server(actor,'met',jsonb_build_object('id',m,'revision',rev,'requestKey',gen_random_uuid()));
  perform public.meetup_command_server(peer,'met',jsonb_build_object('id',m,'revision',rev,'requestKey',gen_random_uuid()));
  begin
    perform public.meetup_command_server(actor,'place',jsonb_build_object('id',m,'revision',rev,'requestKey',gen_random_uuid(),'placeLabel','Too late'));
    raise exception 'PLACE_CHANGED_AFTER_MEETING';
  exception when others then if sqlerrm<>'MEETUP_PLACE_LOCKED' then raise; end if; end;
  perform public.meetup_command_server(actor,'end',jsonb_build_object('id',m,'revision',rev,'requestKey',gen_random_uuid()));
  if not exists(select 1 from jsonb_array_elements(public.list_meetups_server(actor)) x where x->>'id'=m::text and x->>'endReason'='ended' and x->>'endedAt' is not null) then raise exception 'RECENT_END_MISSING'; end if;
  perform public.meetup_discovery_command_server(actor,'delete',jsonb_build_object('id',d));
  if not exists(select 1 from public.meetups where id=m) then raise exception 'LISTING_DELETE_REMOVED_MEETUP'; end if;
  if exists(select 1 from jsonb_array_elements(public.list_meetup_discoveries_server(actor)->'mine') x where x->>'id'=d::text) then raise exception 'DELETED_LISTING_STILL_VISIBLE'; end if;

  insert into public.meetup_discoveries(creator_id,title,meetup_style,starts_at,timezone,listing_duration_minutes,listing_expires_at,max_attendees,request_key,status)
    values(actor,'Group proof','group',now()+interval '1 day','UTC',60,now()+interval '1 hour',6,gen_random_uuid(),'matched') returning id into gd;
  insert into public.meetups(creator_id,mode,place_label,starts_at,expires_at,timezone,request_key,source_discovery_id)
    values(actor,'meet_somewhere','Group proof',now()+interval '1 day',now()+interval '30 hours','UTC',gen_random_uuid(),gd) returning id into gm;
  insert into public.meetup_participants(meetup_id,user_id,response) values(gm,actor,'accepted'),(gm,peer,'accepted');
  for i in 1..3 loop
    perform public.create_meetup_discovery_server(actor,jsonb_build_object('title','Open proof','category','coffee','style','group','startsAt',now()+interval '1 day','timezone','UTC','durationMinutes',60,'requestKey',gen_random_uuid()));
  end loop;
  perform public.meetup_command_server(peer,'respond',jsonb_build_object('id',gm,'revision',1,'requestKey',gen_random_uuid(),'response','declined'));
  if not exists(select 1 from public.meetup_participants where meetup_id=gm and user_id=peer and response='declined') then raise exception 'DEPARTURE_BLOCKED'; end if;
  if public.meetup_owner_active_slot_count(actor)<>3 then raise exception 'DEPARTURE_REOPENED_LISTING'; end if;
  begin
    perform public.meetup_discovery_command_server(actor,'refresh',jsonb_build_object('id',gd));
    raise exception 'RENEW_BYPASSED_LIMIT';
  exception when others then if sqlerrm<>'MEETUP_LIMIT' then raise; end if; end;
  select id into d from public.meetup_discoveries where creator_id=actor and status='active' order by created_at desc limit 1;
  perform public.meetup_discovery_command_server(actor,'close',jsonb_build_object('id',d));
  perform public.meetup_discovery_command_server(actor,'refresh',jsonb_build_object('id',gd));
  if public.meetup_owner_active_slot_count(actor)<>3 then raise exception 'RENEW_DID_NOT_USE_FREE_SLOT'; end if;
  update public.meetups set expires_at=now()-interval '1 minute' where id=gm;
  perform public.expire_meetups_server();
  if not exists(select 1 from jsonb_array_elements(public.list_meetups_server(actor)) x where x->>'id'=gm::text and x->>'endReason'='expired') then raise exception 'EXPIRY_ACK_MISSING'; end if;
end $$;
rollback;
select 'PASS: until-start listing, expired inbox, moving receipt, matching/chat, place auth/idempotency/notification, simple arrival, recent outcomes, independent listing deletion, departure at capacity, controlled renewal' as result;
