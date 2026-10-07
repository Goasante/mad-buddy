-- Server-only owner edits. Never extend expiry, change capacity, or recreate a
-- listing/chat merely because its title, category or scheduled time changes.
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
  if v_d.id is null then raise exception 'DISCOVERY_NOT_FOUND'; end if;
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
    starts_at=v_start,timezone=v_timezone,updated_at=now() where id=v_id;
  return jsonb_build_object('id',v_id,'changed',true,'timeChanged',v_time_changed,'meetupId',v_m.id);
end $$;

revoke all on function public.edit_meetup_discovery_server(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.edit_meetup_discovery_server(uuid,jsonb) to service_role;
