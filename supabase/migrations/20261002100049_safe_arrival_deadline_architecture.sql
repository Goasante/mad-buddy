-- Safe Arrival: deadline-driven lifecycle. The existing five-minute sweep
-- remains as a bounded safety backstop. No continuous location stream is added.

create or replace function public.enqueue_safe_arrival_deadline(
  p_session_id uuid,
  p_run_at timestamptz,
  p_phase text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_key text;
begin
  if p_session_id is null or p_run_at is null or p_phase not in ('arrival_due','expire') then
    raise exception 'safe_arrival_invalid_deadline';
  end if;
  v_key := concat('safe-arrival-deadline:',p_session_id,':',p_phase,':',(extract(epoch from p_run_at)*1000)::bigint);
  insert into public.jobs(job_type,payload,priority,status,idempotency_key,run_at)
  values(
    'safe_arrival.deadline',
    jsonb_build_object('sessionId',p_session_id,'phase',p_phase,'scheduledFor',p_run_at),
    1,'scheduled',v_key,p_run_at
  )
  on conflict (idempotency_key) where idempotency_key is not null do nothing;
  return found;
end;
$$;

CREATE OR REPLACE FUNCTION public.start_safe_arrival(p_traveller_id uuid, p_destination_label text, p_expected_arrival_at timestamp with time zone, p_grace_period_minutes integer, p_note text, p_contact_ids uuid[], p_max_active integer)
 RETURNS TABLE(session_id uuid, replayed boolean, canonical_status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id uuid; v_eligible uuid[]; v_count integer;
begin
  if p_traveller_id is null or nullif(btrim(p_destination_label),'') is null then raise exception 'safe_arrival_invalid'; end if;
  if p_expected_arrival_at <= now() or p_grace_period_minutes not between 5 and 120 then raise exception 'safe_arrival_invalid'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_traveller_id::text, 812731));
  select s.id into v_id from public.safe_arrival_sessions s
    where s.traveller_id=p_traveller_id and s.destination_label=btrim(p_destination_label)
      and s.expected_arrival_at=p_expected_arrival_at and s.status in ('active','extended')
      and s.created_at > now()-interval '2 minutes' order by s.created_at desc limit 1;
  if v_id is not null then return query select v_id,true,'active'::text; return; end if;
  select count(*) into v_count from public.safe_arrival_sessions s where s.traveller_id=p_traveller_id
    and s.status in ('draft','pending_acknowledgement','active','grace_period','extended','unconfirmed');
  if p_max_active is not null and v_count >= p_max_active then raise exception 'safe_arrival_active_limit'; end if;
  select coalesce(array_agg(distinct x.id),'{}'::uuid[]) into v_eligible from unnest(p_contact_ids) x(id)
    where x.id<>p_traveller_id and public.safe_arrival_relationship_current(p_traveller_id,x.id)
      and not exists(select 1 from public.safe_arrival_blocks m where m.user_id=x.id and m.blocked_traveller_id=p_traveller_id);
  if cardinality(v_eligible)=0 then raise exception 'safe_arrival_no_watchers'; end if;
  insert into public.safe_arrival_sessions(traveller_id,destination_type,destination_label,expected_arrival_at,grace_period_minutes,note,status)
    values(p_traveller_id,'custom',btrim(p_destination_label),p_expected_arrival_at,p_grace_period_minutes,nullif(btrim(coalesce(p_note,'')),''),'active') returning id into v_id;
  insert into public.safe_arrival_contacts(session_id,contact_user_id,notified_at) select v_id,x,now() from unnest(v_eligible) x;
  insert into public.safe_arrival_events(session_id,event_type,created_by,metadata)
    values(v_id,'created',p_traveller_id,jsonb_build_object('watcherCount',cardinality(v_eligible)));
  perform public.enqueue_safe_arrival_notifications(v_id,'started',v_eligible,p_traveller_id);
  perform public.enqueue_safe_arrival_deadline(v_id,p_expected_arrival_at+make_interval(mins=>p_grace_period_minutes),'arrival_due');
  return query select v_id,false,'active'::text;
end; $function$;

CREATE OR REPLACE FUNCTION public.transition_safe_arrival(p_session_id uuid, p_actor_id uuid, p_action text, p_extra_minutes integer DEFAULT NULL::integer, p_client_mutation_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(session_id uuid, canonical_status text, changed boolean, expected_arrival_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v public.safe_arrival_sessions%rowtype; v_next timestamptz; v_recipients uuid[]; v_event text;
begin
  -- The row lock already serialises concurrent callers; the claim below rides
  -- inside it, so "has this intent been applied" and "apply it" cannot race.
  select * into v from public.safe_arrival_sessions where id=p_session_id for update;
  if not found then raise exception 'safe_arrival_not_found'; end if;
  if v.traveller_id<>p_actor_id then raise exception 'safe_arrival_forbidden'; end if;
  if p_action='arrive' then
    if v.status='completed' then return query select v.id,v.status,false,v.expected_arrival_at; return; end if;
    if v.status in ('cancelled','expired') then
      insert into public.safe_arrival_events(session_id,event_type,created_by,metadata) values(v.id,'transition_conflict',p_actor_id,jsonb_build_object('attempted','arrive','canonical',v.status));
      return query select v.id,v.status,false,v.expected_arrival_at; return;
    end if;
    update public.safe_arrival_sessions set status='completed',confirmed_at=now(),updated_at=now() where id=v.id;
    v_event:='arrived';
    insert into public.safe_arrival_events(session_id,event_type,created_by) values(v.id,'confirmed',p_actor_id);
  elsif p_action='cancel' then
    if v.status='cancelled' then return query select v.id,v.status,false,v.expected_arrival_at; return; end if;
    if v.status in ('completed','expired') then
      insert into public.safe_arrival_events(session_id,event_type,created_by,metadata) values(v.id,'transition_conflict',p_actor_id,jsonb_build_object('attempted','cancel','canonical',v.status));
      return query select v.id,v.status,false,v.expected_arrival_at; return;
    end if;
    update public.safe_arrival_sessions set status='cancelled',cancelled_at=now(),updated_at=now() where id=v.id;
    v_event:='cancelled';
    insert into public.safe_arrival_events(session_id,event_type,created_by) values(v.id,'cancelled',p_actor_id);
  elsif p_action='extend' then
    if v.status in ('completed','cancelled','expired') then
      insert into public.safe_arrival_events(session_id,event_type,created_by,metadata) values(v.id,'transition_conflict',p_actor_id,jsonb_build_object('attempted','extend','canonical',v.status));
      return query select v.id,v.status,false,v.expected_arrival_at; return;
    end if;
    if p_extra_minutes is null or p_extra_minutes not between 5 and 120 then raise exception 'safe_arrival_invalid_extension'; end if;

    /* ALREADY APPLIED? Return the canonical clock rather than moving it again.
       Reported as changed=false: nothing happened on THIS call, and the caller
       still receives the true expected_arrival_at. */
    if p_client_mutation_id is not null and exists (
      select 1 from public.safe_arrival_events e
      where e.session_id=v.id and e.event_type='extended' and e.client_mutation_id=p_client_mutation_id
    ) then
      return query select v.id,v.status,false,v.expected_arrival_at; return;
    end if;

    v_next:=greatest(v.expected_arrival_at,now())+make_interval(mins=>p_extra_minutes);
    update public.safe_arrival_sessions set status='extended',expected_arrival_at=v_next,unconfirmed_at=null,unconfirmed_notified_at=null,updated_at=now() where id=v.id;
    v_event:='extended';
    insert into public.safe_arrival_events(session_id,event_type,created_by,metadata,client_mutation_id)
      values(v.id,'extended',p_actor_id,jsonb_build_object('extraMinutes',p_extra_minutes),p_client_mutation_id);
    perform public.enqueue_safe_arrival_deadline(v.id,v_next+make_interval(mins=>v.grace_period_minutes),'arrival_due');
  else raise exception 'safe_arrival_invalid_action'; end if;
  select coalesce(array_agg(c.contact_user_id),'{}'::uuid[]) into v_recipients from public.safe_arrival_contacts c
    where c.session_id=v.id and c.acknowledgement_status<>'declined'
      and public.safe_arrival_relationship_current(v.traveller_id,c.contact_user_id)
      and not exists(select 1 from public.safe_arrival_blocks m
        where m.user_id=c.contact_user_id and m.blocked_traveller_id=v.traveller_id);
    perform public.enqueue_safe_arrival_notifications(v.id,v_event,v_recipients,p_actor_id,
      case when v_event='extended' then v_next::text else null end);
  return query select v.id,case when p_action='arrive' then 'completed' when p_action='cancel' then 'cancelled' else 'extended' end,true,coalesce(v_next,v.expected_arrival_at);
end; $function$;

create or replace function public.process_safe_arrival_deadline(p_session_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.safe_arrival_sessions%rowtype;
  v_due timestamptz;
  v_recipients uuid[];
begin
  select * into v from public.safe_arrival_sessions where id=p_session_id for update;
  if not found then return 'missing'; end if;
  if v.status in ('completed','cancelled','expired') then return 'closed'; end if;

  if v.status in ('active','grace_period','extended') then
    v_due := v.expected_arrival_at + make_interval(mins=>v.grace_period_minutes);
    if now() < v_due then return 'not_due'; end if;

    select coalesce(array_agg(c.contact_user_id),'{}'::uuid[]) into v_recipients
    from public.safe_arrival_contacts c
    where c.session_id=v.id
      and c.acknowledgement_status<>'declined'
      and public.safe_arrival_relationship_current(v.traveller_id,c.contact_user_id)
      and not exists(
        select 1 from public.safe_arrival_blocks m
        where m.user_id=c.contact_user_id and m.blocked_traveller_id=v.traveller_id
      );

    update public.safe_arrival_sessions
    set status='unconfirmed',unconfirmed_at=now(),unconfirmed_notified_at=now(),updated_at=now()
    where id=v.id;
    insert into public.safe_arrival_events(session_id,event_type,created_by,metadata)
    values(v.id,'unconfirmed_alert',null,jsonb_build_object('gracePeriodEndedAt',v_due));
    perform public.enqueue_safe_arrival_notifications(v.id,'unconfirmed',v_recipients,null);
    perform public.enqueue_safe_arrival_deadline(v.id,now()+interval '12 hours','expire');
    return 'unconfirmed';
  end if;

  if v.status='unconfirmed' then
    if v.unconfirmed_at is null then return 'not_due'; end if;
    v_due := v.unconfirmed_at + interval '12 hours';
    if now() < v_due then return 'not_due'; end if;

    select coalesce(array_agg(c.contact_user_id),'{}'::uuid[]) into v_recipients
    from public.safe_arrival_contacts c
    where c.session_id=v.id
      and c.acknowledgement_status<>'declined'
      and public.safe_arrival_relationship_current(v.traveller_id,c.contact_user_id)
      and not exists(
        select 1 from public.safe_arrival_blocks m
        where m.user_id=c.contact_user_id and m.blocked_traveller_id=v.traveller_id
      );

    update public.safe_arrival_sessions set status='expired',expired_at=now(),updated_at=now() where id=v.id;
    insert into public.safe_arrival_events(session_id,event_type,created_by) values(v.id,'expired',null);
    perform public.enqueue_safe_arrival_notifications(v.id,'expired',v_recipients,null);
    return 'expired';
  end if;

  return 'noop';
end;
$$;

create or replace function public.process_due_safe_arrivals(p_limit integer default 200)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v record; v_count integer:=0; v_result text;
begin
  for v in
    select s.id
    from public.safe_arrival_sessions s
    where
      (s.status in ('active','grace_period','extended')
        and s.expected_arrival_at+make_interval(mins=>s.grace_period_minutes)<=now())
      or
      (s.status='unconfirmed' and s.unconfirmed_at+interval '12 hours'<=now())
    order by
      case when s.status='unconfirmed'
        then s.unconfirmed_at+interval '12 hours'
        else s.expected_arrival_at+make_interval(mins=>s.grace_period_minutes)
      end,
      s.id
    limit least(greatest(p_limit,1),1000)
    for update skip locked
  loop
    v_result := public.process_safe_arrival_deadline(v.id);
    if v_result in ('unconfirmed','expired') then v_count := v_count + 1; end if;
  end loop;
  return v_count;
end;
$$;

select public.enqueue_safe_arrival_deadline(
  s.id,
  s.expected_arrival_at+make_interval(mins=>s.grace_period_minutes),
  'arrival_due'
)
from public.safe_arrival_sessions s
where s.status in ('active','grace_period','extended');

select public.enqueue_safe_arrival_deadline(s.id,s.unconfirmed_at+interval '12 hours','expire')
from public.safe_arrival_sessions s
where s.status='unconfirmed' and s.unconfirmed_at is not null;

revoke all on function public.enqueue_safe_arrival_deadline(uuid,timestamptz,text) from public,anon,authenticated;
grant execute on function public.enqueue_safe_arrival_deadline(uuid,timestamptz,text) to service_role;
revoke all on function public.process_safe_arrival_deadline(uuid) from public,anon,authenticated;
grant execute on function public.process_safe_arrival_deadline(uuid) to service_role;

do $$
begin
  if has_function_privilege('anon','public.process_safe_arrival_deadline(uuid)','execute')
     or has_function_privilege('authenticated','public.process_safe_arrival_deadline(uuid)','execute') then
    raise exception 'safe_arrival_deadline_browser_execute_not_revoked';
  end if;
  if not has_function_privilege('service_role','public.process_safe_arrival_deadline(uuid)','execute') then
    raise exception 'safe_arrival_deadline_service_role_missing';
  end if;
end $$;
