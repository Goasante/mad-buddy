-- Run against staging. All fixture changes roll back, including milestone rows.
begin;
do $$
declare
  actor uuid;
  listing uuid;
  expired_listing uuid;
  i integer;
begin
  select user_id into actor from public.profiles order by user_id limit 1;
  if actor is null then raise exception 'PROOF_REQUIRES_PROFILE'; end if;
  update public.meetup_discoveries set status='cancelled' where creator_id=actor;

  for i in 1..3 loop
    insert into public.meetups(creator_id,mode,place_label,starts_at,expires_at,timezone,request_key)
    values(actor,'meet_somewhere','Limit proof',now()+interval '1 day',now()+interval '30 hours','UTC',gen_random_uuid());
  end loop;
  if public.meetup_owner_active_slot_count(actor)<>0 then raise exception 'PLANS_CONSUME_SLOTS'; end if;

  for i in 1..3 loop
    insert into public.meetup_discoveries(creator_id,title,category,meetup_style,starts_at,timezone,
      listing_duration_minutes,listing_expires_at,max_attendees,request_key)
    values(actor,'Limit proof','anything','group',now()+interval '1 day','UTC',60,
      now()+interval '1 hour',6,gen_random_uuid()) returning id into listing;
  end loop;
  if public.meetup_owner_active_slot_count(actor)<>3 then raise exception 'OPEN_LISTING_COUNT_WRONG'; end if;
  begin
    insert into public.meetup_discoveries(creator_id,title,category,meetup_style,starts_at,timezone,
      listing_duration_minutes,listing_expires_at,max_attendees,request_key)
    values(actor,'Fourth listing','anything','group',now()+interval '1 day','UTC',60,
      now()+interval '1 hour',6,gen_random_uuid());
    raise exception 'FOURTH_LISTING_ALLOWED';
  exception when others then
    if sqlerrm<>'MEETUP_LIMIT' then raise; end if;
  end;

  insert into public.meetup_discoveries(creator_id,title,category,meetup_style,starts_at,timezone,
    listing_duration_minutes,listing_expires_at,max_attendees,request_key,status)
  values(actor,'Expired listing','anything','group',now()+interval '1 day','UTC',60,
    now()-interval '1 hour',6,gen_random_uuid(),'expired') returning id into expired_listing;
  begin
    update public.meetup_discoveries set status='active',listing_expires_at=now()+interval '1 hour'
    where id=expired_listing;
    raise exception 'REFRESH_BYPASSED_LIMIT';
  exception when others then
    if sqlerrm<>'MEETUP_LIMIT' then raise; end if;
  end;

  -- A group listing still taking people counts once even after creating a Plan.
  insert into public.meetups(creator_id,mode,place_label,starts_at,expires_at,timezone,request_key,source_discovery_id)
  values(actor,'meet_somewhere','Linked plan',now()+interval '1 day',now()+interval '30 hours','UTC',gen_random_uuid(),listing);
  if public.meetup_owner_active_slot_count(actor)<>3 then raise exception 'LINKED_PLAN_COUNT_WRONG'; end if;

  update public.meetup_discoveries set status='matched' where id=listing;
  if public.meetup_owner_active_slot_count(actor)<>2 then raise exception 'MATCHED_LISTING_USES_SLOT'; end if;
  update public.meetup_discoveries set status='active',listing_expires_at=now()+interval '1 hour' where id=expired_listing;
  if public.meetup_owner_active_slot_count(actor)<>3 then raise exception 'FREED_SLOT_UNUSABLE'; end if;
  update public.meetup_discoveries set listing_expires_at=now()-interval '1 minute' where id=expired_listing;
  if public.meetup_owner_active_slot_count(actor)<>2 then raise exception 'EXPIRED_LISTING_USES_SLOT'; end if;
  update public.meetup_discoveries set starts_at=now()-interval '1 minute' where id=listing;
  update public.meetup_discoveries set status='active',listing_expires_at=now()+interval '1 hour' where id=listing;
  if public.meetup_owner_active_slot_count(actor)<>2 then raise exception 'PAST_START_USES_SLOT'; end if;
end $$;
rollback;
select 'PASS: plans excluded, open limit enforced, refresh guarded, linked groups counted once, matched and expired slots freed' as result;
