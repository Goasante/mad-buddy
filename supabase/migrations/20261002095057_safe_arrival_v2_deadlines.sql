-- Safe Arrival v2: deadline-driven lifecycle with the existing five-minute
-- sweep retained as a priority-1 safety backstop.
--
-- No route history or continuous device stream is introduced. The server keeps
-- only the canonical journey state and the timing contract it already owns.

create index if not exists jobs_safe_arrival_deadline_idx
  on public.jobs(status, run_at, created_at)
  where job_type = 'safe_arrival.deadline_check';

create or replace function public.enqueue_safe_arrival_deadline(
  p_session_id uuid,
  p_run_at timestamptz,
  p_kind text
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
  v_count integer := 0;
begin
  if p_session_id is null or p_run_at is null or p_kind not in ('check_in','expire') then
    raise exception 'safe_arrival_invalid_deadline';
  end if;

  v_key := concat(
    'safe-arrival-deadline:',
    p_session_id,
    ':',
    p_kind,
    ':',
    floor(extract(epoch from p_run_at) * 1000)::bigint
  );

  insert into public.jobs(job_type,payload,priority,status,idempotency_key,run_at)
  values (
    'safe_arrival.deadline_check',
    jsonb_build_object('sessionId',p_session_id,'kind',p_kind),
    1,
    'scheduled',
    v_key,
    p_run_at
  )
  on conflict (idempotency_key) where idempotency_key is not null do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.process_safe_arrival_deadline(p_session_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.safe_arrival_sessions%rowtype;
  v_recipients uuid[];
  v_now timestamptz := now();
begin
  select *
  into v
  from public.safe_arrival_sessions
  where id = p_session_id
  for update;

  if not found then return 0; end if;
  if v.status in ('completed','cancelled','expired') then return 0; end if;

  select coalesce(array_agg(c.contact_user_id),'{}'::uuid[])
  into v_recipients
  from public.safe_arrival_contacts c
  where c.session_id = v.id
    and c.acknowledgement_status <> 'declined'
    and public.safe_arrival_relationship_current(v.traveller_id,c.contact_user_id)
    and not exists (
      select 1
      from public.safe_arrival_blocks m
      where m.user_id = c.contact_user_id
        and m.blocked_traveller_id = v.traveller_id
    );

  if v.status = 'unconfirmed' then
    if v.unconfirmed_at is null or v.unconfirmed_at + interval '12 hours' > v_now then
      return 0;
    end if;

    update public.safe_arrival_sessions
    set status='expired', expired_at=v_now, updated_at=v_now
    where id=v.id and status='unconfirmed';
    if not found then return 0; end if;

    insert into public.safe_arrival_events(session_id,event_type,created_by)
    values(v.id,'expired',null);

    perform public.enqueue_safe_arrival_notifications(
      v.id,'expired',v_recipients,null
    );
    return 1;
  end if;

  if v.status not in ('active','grace_period','extended') then return 0; end if;

  if v.expected_arrival_at + make_interval(mins=>v.grace_period_minutes) > v_now then
    return 0;
  end if;

  update public.safe_arrival_sessions
  set status='unconfirmed',
      unconfirmed_at=v_now,
      unconfirmed_notified_at=v_now,
      updated_at=v_now
  where id=v.id and status in ('active','grace_period','extended');
  if not found then return 0; end if;

  insert into public.safe_arrival_events(session_id,event_type,created_by)
  values(v.id,'unconfirmed_alert',null);

  perform public.enqueue_safe_arrival_notifications(
    v.id,'unconfirmed',v_recipients,null
  );

  perform public.enqueue_safe_arrival_deadline(
    v.id,
    v_now + interval '12 hours',
    'expire'
  );

  return 1;
end;
$$;

create or replace function public.start_safe_arrival(
  p_traveller_id uuid,
  p_destination_label text,
  p_expected_arrival_at timestamptz,
  p_grace_period_minutes integer,
  p_note text,
  p_contact_ids uuid[],
  p_max_active integer
) returns table(session_id uuid, replayed boolean, canonical_status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_eligible uuid[];
  v_count integer;
begin
  if p_traveller_id is null or nullif(btrim(p_destination_label),'') is null then
    raise exception 'safe_arrival_invalid';
  end if;
  if p_expected_arrival_at <= now() or p_grace_period_minutes not between 5 and 120 then
    raise exception 'safe_arrival_invalid';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_traveller_id::text,812731));

  select s.id
  into v_id
  from public.safe_arrival_sessions s
  where s.traveller_id=p_traveller_id
    and s.destination_label=btrim(p_destination_label)
    and s.expected_arrival_at=p_expected_arrival_at
    and s.status in ('active','extended')
    and s.created_at > now()-interval '2 minutes'
  order by s.created_at desc
  limit 1;

  if v_id is not null then
    return query select v_id,true,'active'::text;
    return;
  end if;

  select count(*)
  into v_count
  from public.safe_arrival_sessions s
  where s.traveller_id=p_traveller_id
    and s.status in ('draft','pending_acknowledgement','active','grace_period','extended','unconfirmed');

  if p_max_active is not null and v_count >= p_max_active then
    raise exception 'safe_arrival_active_limit';
  end if;

  select coalesce(array_agg(distinct x.id),'{}'::uuid[])
  into v_eligible
  from unnest(p_contact_ids) x(id)
  where x.id<>p_traveller_id
    and public.safe_arrival_relationship_current(p_traveller_id,x.id)
    and not exists (
      select 1
      from public.safe_arrival_blocks m
      where m.user_id=x.id and m.blocked_traveller_id=p_traveller_id
    );

  if cardinality(v_eligible)=0 then
    raise exception 'safe_arrival_no_watchers';
  end if;

  insert into public.safe_arrival_sessions(
    traveller_id,destination_type,destination_label,expected_arrival_at,
    grace_period_minutes,note,status
  )
  values(
    p_traveller_id,'custom',btrim(p_destination_label),p_expected_arrival_at,
    p_grace_period_minutes,nullif(btrim(coalesce(p_note,'')),''),'active'
  )
  returning id into v_id;

  insert into public.safe_arrival_contacts(session_id,contact_user_id,notified_at)
  select v_id,x,now() from unnest(v_eligible) x;

  insert into public.safe_arrival_events(session_id,event_type,created_by,metadata)
  values(
    v_id,'created',p_traveller_id,
    jsonb_build_object('watcherCount',cardinality(v_eligible))
  );

  perform public.enqueue_safe_arrival_notifications(
    v_id,'started',v_eligible,p_traveller_id
  );

  perform public.enqueue_safe_arrival_deadline(
    v_id,
    p_expected_arrival_at + make_interval(mins=>p_grace_period_minutes),
    'check_in'
  );

  return query select v_id,false,'active'::text;
end;
$$;

create or replace function public.transition_safe_arrival(
  p_session_id uuid,
  p_actor_id uuid,
  p_action text,
  p_extra_minutes integer default null,
  p_client_mutation_id uuid default null
) returns table(
  session_id uuid,
  canonical_status text,
  changed boolean,
  expected_arrival_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.safe_arrival_sessions%rowtype;
  v_next timestamptz;
  v_recipients uuid[];
  v_event text;
begin
  select * into v
  from public.safe_arrival_sessions
  where id=p_session_id
  for update;

  if not found then raise exception 'safe_arrival_not_found'; end if;
  if v.traveller_id<>p_actor_id then raise exception 'safe_arrival_forbidden'; end if;

  if p_action='arrive' then
    if v.status='completed' then
      return query select v.id,v.status,false,v.expected_arrival_at;
      return;
    end if;
    if v.status in ('cancelled','expired') then
      insert into public.safe_arrival_events(session_id,event_type,created_by,metadata)
      values(v.id,'transition_conflict',p_actor_id,jsonb_build_object('attempted','arrive','canonical',v.status));
      return query select v.id,v.status,false,v.expected_arrival_at;
      return;
    end if;

    update public.safe_arrival_sessions
    set status='completed',confirmed_at=now(),updated_at=now()
    where id=v.id;
    v_event:='arrived';

    insert into public.safe_arrival_events(session_id,event_type,created_by)
    values(v.id,'confirmed',p_actor_id);

  elsif p_action='cancel' then
    if v.status='cancelled' then
      return query select v.id,v.status,false,v.expected_arrival_at;
      return;
    end if;
    if v.status in ('completed','expired') then
      insert into public.safe_arrival_events(session_id,event_type,created_by,metadata)
      values(v.id,'transition_conflict',p_actor_id,jsonb_build_object('attempted','cancel','canonical',v.status));
      return query select v.id,v.status,false,v.expected_arrival_at;
      return;
    end if;

    update public.safe_arrival_sessions
    set status='cancelled',cancelled_at=now(),updated_at=now()
    where id=v.id;
    v_event:='cancelled';

    insert into public.safe_arrival_events(session_id,event_type,created_by)
    values(v.id,'cancelled',p_actor_id);

  elsif p_action='extend' then
    if v.status in ('completed','cancelled','expired') then
      insert into public.safe_arrival_events(session_id,event_type,created_by,metadata)
      values(v.id,'transition_conflict',p_actor_id,jsonb_build_object('attempted','extend','canonical',v.status));
      return query select v.id,v.status,false,v.expected_arrival_at;
      return;
    end if;

    if p_extra_minutes is null or p_extra_minutes not between 5 and 120 then
      raise exception 'safe_arrival_invalid_extension';
    end if;

    if p_client_mutation_id is not null and exists (
      select 1
      from public.safe_arrival_events e
      where e.session_id=v.id
        and e.event_type='extended'
        and e.client_mutation_id=p_client_mutation_id
    ) then
      return query select v.id,v.status,false,v.expected_arrival_at;
      return;
    end if;

    v_next:=greatest(v.expected_arrival_at,now())+make_interval(mins=>p_extra_minutes);

    update public.safe_arrival_sessions
    set status='extended',
        expected_arrival_at=v_next,
        unconfirmed_at=null,
        unconfirmed_notified_at=null,
        updated_at=now()
    where id=v.id;
    v_event:='extended';

    insert into public.safe_arrival_events(
      session_id,event_type,created_by,metadata,client_mutation_id
    )
    values(
      v.id,'extended',p_actor_id,
      jsonb_build_object('extraMinutes',p_extra_minutes),p_client_mutation_id
    );

    perform public.enqueue_safe_arrival_deadline(
      v.id,
      v_next + make_interval(mins=>v.grace_period_minutes),
      'check_in'
    );

  else
    raise exception 'safe_arrival_invalid_action';
  end if;

  select coalesce(array_agg(c.contact_user_id),'{}'::uuid[])
  into v_recipients
  from public.safe_arrival_contacts c
  where c.session_id=v.id
    and c.acknowledgement_status<>'declined'
    and public.safe_arrival_relationship_current(v.traveller_id,c.contact_user_id)
    and not exists (
      select 1 from public.safe_arrival_blocks m
      where m.user_id=c.contact_user_id
        and m.blocked_traveller_id=v.traveller_id
    );

  perform public.enqueue_safe_arrival_notifications(
    v.id,v_event,v_recipients,p_actor_id,
    case when v_event='extended' then v_next::text else null end
  );

  return query
  select
    v.id,
    case
      when p_action='arrive' then 'completed'
      when p_action='cancel' then 'cancelled'
      else 'extended'
    end,
    true,
    coalesce(v_next,v.expected_arrival_at);
end;
$$;

-- The five-minute job is now a repair/backstop around the same per-session
-- processor rather than a second copy of lifecycle logic.
create or replace function public.process_due_safe_arrivals(p_limit integer default 200)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v record;
  v_count integer := 0;
begin
  for v in
    select s.id
    from public.safe_arrival_sessions s
    where (
      s.status in ('active','grace_period','extended')
      and s.expected_arrival_at + make_interval(mins=>s.grace_period_minutes) <= now()
    ) or (
      s.status='unconfirmed'
      and s.unconfirmed_at + interval '12 hours' <= now()
    )
    order by
      case
        when s.status='unconfirmed' then s.unconfirmed_at + interval '12 hours'
        else s.expected_arrival_at + make_interval(mins=>s.grace_period_minutes)
      end,
      s.id
    limit least(greatest(p_limit,1),1000)
  loop
    v_count := v_count + public.process_safe_arrival_deadline(v.id);
  end loop;

  return v_count;
end;
$$;

-- Include completed deadline jobs in the existing 30-day operational cleanup.
create or replace function private.prune_operational_history()
returns table(
  periodic_jobs_deleted bigint,
  rate_limit_rows_deleted bigint,
  cron_runs_deleted bigint
)
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_jobs bigint := 0;
  v_rate_limits bigint := 0;
  v_cron bigint := 0;
begin
  delete from public.jobs
  where status='completed'
    and (
      idempotency_key like 'periodic:%'
      or job_type='safe_arrival.deadline_check'
    )
    and completed_at is not null
    and completed_at < now()-interval '30 days';
  get diagnostics v_jobs = row_count;

  delete from public.rate_limits
  where window_end < now()-interval '30 days';
  get diagnostics v_rate_limits = row_count;

  delete from cron.job_run_details
  where end_time is not null
    and end_time < now()-interval '30 days';
  get diagnostics v_cron = row_count;

  return query select v_jobs,v_rate_limits,v_cron;
end;
$$;

-- Backfill existing live journeys without changing their state.
select public.enqueue_safe_arrival_deadline(
  id,
  greatest(now(),expected_arrival_at+make_interval(mins=>grace_period_minutes)),
  'check_in'
)
from public.safe_arrival_sessions
where status in ('active','grace_period','extended');

select public.enqueue_safe_arrival_deadline(
  id,
  greatest(now(),unconfirmed_at+interval '12 hours'),
  'expire'
)
from public.safe_arrival_sessions
where status='unconfirmed' and unconfirmed_at is not null;

-- All lifecycle mutators are server-only.
revoke all on function public.enqueue_safe_arrival_deadline(uuid,timestamptz,text)
  from public,anon,authenticated;
grant execute on function public.enqueue_safe_arrival_deadline(uuid,timestamptz,text)
  to service_role;

revoke all on function public.process_safe_arrival_deadline(uuid)
  from public,anon,authenticated;
grant execute on function public.process_safe_arrival_deadline(uuid)
  to service_role;

revoke all on function public.start_safe_arrival(uuid,text,timestamptz,integer,text,uuid[],integer)
  from public,anon,authenticated;
grant execute on function public.start_safe_arrival(uuid,text,timestamptz,integer,text,uuid[],integer)
  to service_role;

revoke all on function public.process_due_safe_arrivals(integer)
  from public,anon,authenticated;
grant execute on function public.process_due_safe_arrivals(integer)
  to service_role;

revoke all on function private.prune_operational_history()
  from public,anon,authenticated;
grant execute on function private.prune_operational_history()
  to service_role;

-- A function signature is a distinct Postgres object. Normalize every current
-- transition overload, preserving the hardened server-only authority.
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname='transition_safe_arrival'
      and p.prokind='f'
  loop
    execute format('revoke all on function %s from public',r.sig);
    execute format('revoke all on function %s from anon',r.sig);
    execute format('revoke all on function %s from authenticated',r.sig);
    execute format('grant execute on function %s to service_role',r.sig);
  end loop;
end
$$;
