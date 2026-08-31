-- Safe Arrival S1: canonical lifecycle authority and durable notifications.
-- Destination labels only. No coordinates, routes, or background location.

alter table public.safe_arrival_sessions
  add column if not exists unconfirmed_at timestamptz,
  add column if not exists expired_at timestamptz;

alter table public.notifications add column if not exists dedupe_key text;
create unique index if not exists notifications_dedupe_key_unique
  on public.notifications(dedupe_key) where dedupe_key is not null;

alter table public.safe_arrival_events drop constraint if exists safe_arrival_events_event_type_check;
alter table public.safe_arrival_events add constraint safe_arrival_events_event_type_check check (
  event_type in ('created','acknowledged','declined','extended','confirmed','cancelled','unconfirmed_alert','expired','transition_conflict')
);

create index if not exists safe_arrival_due_s1_idx
  on public.safe_arrival_sessions (expected_arrival_at, id)
  where status in ('active','grace_period','extended');
create index if not exists safe_arrival_expiry_s1_idx
  on public.safe_arrival_sessions (unconfirmed_at, id)
  where status = 'unconfirmed';
create index if not exists jobs_safe_arrival_health_s1_idx
  on public.jobs(status, run_at, created_at)
  where job_type = 'safe_arrival.lifecycle_notification';

create or replace function public.safe_arrival_relationship_current(p_traveller uuid, p_watcher uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.friendships f
    where f.ended_at is null and ((f.user_one_id = p_traveller and f.user_two_id = p_watcher)
      or (f.user_one_id = p_watcher and f.user_two_id = p_traveller))
  ) and not exists (
    select 1 from public.blocked_users b
    where (b.blocker_id = p_traveller and b.blocked_id = p_watcher)
       or (b.blocker_id = p_watcher and b.blocked_id = p_traveller)
  );
$$;

create or replace function public.can_view_safe_arrival_session(p_session_id uuid, p_require_accepted boolean default false)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists(select 1 from public.safe_arrival_sessions s where s.id=p_session_id and s.traveller_id=auth.uid())
    or exists(select 1 from public.safe_arrival_sessions s join public.safe_arrival_contacts c on c.session_id=s.id
      where s.id=p_session_id and c.contact_user_id=auth.uid()
        and (case when p_require_accepted then c.acknowledgement_status='watching' else c.acknowledgement_status<>'declined' end)
        and public.safe_arrival_relationship_current(s.traveller_id,auth.uid()));
$$;

drop policy if exists "safe arrival traveller full access" on public.safe_arrival_sessions;
drop policy if exists "safe arrival visible to contacts" on public.safe_arrival_sessions;
create policy "safe arrival traveller read" on public.safe_arrival_sessions for select
  using (auth.uid() = traveller_id);
create policy "safe arrival current contact read" on public.safe_arrival_sessions for select using (
  public.can_view_safe_arrival_session(id, false)
);

drop policy if exists "safe arrival contacts visible to participants" on public.safe_arrival_contacts;
drop policy if exists "safe arrival contact acknowledges own row" on public.safe_arrival_contacts;
create policy "safe arrival contacts current participant read" on public.safe_arrival_contacts for select using (
  public.can_view_safe_arrival_session(session_id, false)
);

drop policy if exists "safe arrival events visible to participants" on public.safe_arrival_events;
create policy "safe arrival events current participant read" on public.safe_arrival_events for select using (
  public.can_view_safe_arrival_session(session_id, true)
);

-- Table privileges and RLS answer different questions. End users receive only
-- SELECT on the three projection tables so the policies above can evaluate;
-- there is deliberately no authenticated INSERT/UPDATE/DELETE authority.
-- The service role owns canonical server mutations and must retain full table
-- access even when `api.auto_expose_new_tables` is disabled locally/cloud-side.
grant select on public.safe_arrival_sessions, public.safe_arrival_contacts,
  public.safe_arrival_events to anon, authenticated;
grant all on public.safe_arrival_sessions, public.safe_arrival_contacts,
  public.safe_arrival_events, public.safe_arrival_blocks to service_role;

create or replace function public.enqueue_safe_arrival_notifications(
  p_session_id uuid, p_event text, p_recipients uuid[], p_actor uuid default null,
  p_occurrence text default null
) returns integer language plpgsql security definer set search_path = public as $$
declare v_recipient uuid; v_count integer := 0; v_key text;
begin
  foreach v_recipient in array coalesce(p_recipients, '{}'::uuid[]) loop
    v_key := concat('safe-arrival:', p_session_id, ':', v_recipient, ':', p_event,
      case when p_occurrence is null then '' else ':'||p_occurrence end);
    insert into public.jobs(job_type,payload,priority,status,idempotency_key,run_at)
    values ('safe_arrival.lifecycle_notification',
      jsonb_build_object('sessionId',p_session_id,'recipientId',v_recipient,'event',p_event,'actorId',p_actor,'notificationKey',v_key),
      1,'queued',v_key,now()) on conflict (idempotency_key) where idempotency_key is not null do nothing;
    if found then v_count := v_count + 1; end if;
  end loop;
  return v_count;
end; $$;

drop function if exists public.start_safe_arrival(uuid,text,timestamptz,integer,text,uuid[],integer);
create function public.start_safe_arrival(
  p_traveller_id uuid, p_destination_label text, p_expected_arrival_at timestamptz,
  p_grace_period_minutes integer, p_note text, p_contact_ids uuid[], p_max_active integer
) returns table(session_id uuid, replayed boolean, canonical_status text)
language plpgsql security definer set search_path = public as $$
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
  return query select v_id,false,'active'::text;
end; $$;

create or replace function public.transition_safe_arrival(
  p_session_id uuid, p_actor_id uuid, p_action text, p_extra_minutes integer default null
) returns table(session_id uuid, canonical_status text, changed boolean, expected_arrival_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare v public.safe_arrival_sessions%rowtype; v_next timestamptz; v_recipients uuid[]; v_event text;
begin
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
    v_next:=greatest(v.expected_arrival_at,now())+make_interval(mins=>p_extra_minutes);
    update public.safe_arrival_sessions set status='extended',expected_arrival_at=v_next,unconfirmed_at=null,unconfirmed_notified_at=null,updated_at=now() where id=v.id;
    v_event:='extended';
    insert into public.safe_arrival_events(session_id,event_type,created_by,metadata) values(v.id,'extended',p_actor_id,jsonb_build_object('extraMinutes',p_extra_minutes));
  else raise exception 'safe_arrival_invalid_action'; end if;
  select coalesce(array_agg(c.contact_user_id),'{}'::uuid[]) into v_recipients from public.safe_arrival_contacts c
    where c.session_id=v.id and c.acknowledgement_status<>'declined'
      and public.safe_arrival_relationship_current(v.traveller_id,c.contact_user_id)
      and not exists(select 1 from public.safe_arrival_blocks m
        where m.user_id=c.contact_user_id and m.blocked_traveller_id=v.traveller_id);
    perform public.enqueue_safe_arrival_notifications(v.id,v_event,v_recipients,p_actor_id,
      case when v_event='extended' then v_next::text else null end);
  return query select v.id,case when p_action='arrive' then 'completed' when p_action='cancel' then 'cancelled' else 'extended' end,true,coalesce(v_next,v.expected_arrival_at);
end; $$;

create or replace function public.process_due_safe_arrivals(p_limit integer default 200)
returns integer language plpgsql security definer set search_path = public as $$
declare v record; v_count integer:=0; v_recipients uuid[];
begin
  for v in select s.* from public.safe_arrival_sessions s where
    (s.status in ('active','grace_period','extended') and s.expected_arrival_at+make_interval(mins=>s.grace_period_minutes)<=now())
    or (s.status='unconfirmed' and s.unconfirmed_at+interval '12 hours'<=now())
    order by case when s.status='unconfirmed' then s.unconfirmed_at+interval '12 hours' else s.expected_arrival_at+make_interval(mins=>s.grace_period_minutes) end,s.id
    limit least(greatest(p_limit,1),1000) for update skip locked
  loop
    select coalesce(array_agg(c.contact_user_id),'{}'::uuid[]) into v_recipients from public.safe_arrival_contacts c
      where c.session_id=v.id and c.acknowledgement_status<>'declined'
        and public.safe_arrival_relationship_current(v.traveller_id,c.contact_user_id)
        and not exists(select 1 from public.safe_arrival_blocks m
          where m.user_id=c.contact_user_id and m.blocked_traveller_id=v.traveller_id);
    if v.status='unconfirmed' then
      update public.safe_arrival_sessions set status='expired',expired_at=now(),updated_at=now() where id=v.id and status='unconfirmed';
      if found then
        insert into public.safe_arrival_events(session_id,event_type,created_by) values(v.id,'expired',null);
        perform public.enqueue_safe_arrival_notifications(v.id,'expired',v_recipients,null); v_count:=v_count+1;
      end if;
    else
      update public.safe_arrival_sessions set status='unconfirmed',unconfirmed_at=now(),unconfirmed_notified_at=now(),updated_at=now()
        where id=v.id and status in ('active','grace_period','extended');
      if found then
        insert into public.safe_arrival_events(session_id,event_type,created_by) values(v.id,'unconfirmed_alert',null);
        perform public.enqueue_safe_arrival_notifications(v.id,'unconfirmed',v_recipients,null); v_count:=v_count+1;
      end if;
    end if;
  end loop; return v_count;
end; $$;

create or replace function public.admin_safe_arrival_health()
returns jsonb language sql stable security definer set search_path=public as $$
select jsonb_build_object(
 'oldestOverdue',min(expected_arrival_at+make_interval(mins=>grace_period_minutes)) filter(where status in('active','grace_period','extended') and expected_arrival_at+make_interval(mins=>grace_period_minutes)<=now()),
 'overdueBacklog',count(*) filter(where status in('active','grace_period','extended') and expected_arrival_at+make_interval(mins=>grace_period_minutes)<=now()),
 'oldestUnconfirmed',min(unconfirmed_at) filter(where status='unconfirmed'),
 'unconfirmedCount',count(*) filter(where status='unconfirmed'),
 'pendingNotificationJobs',(select count(*) from public.jobs where job_type='safe_arrival.lifecycle_notification' and status in('queued','scheduled')),
 'retryingNotificationJobs',(select count(*) from public.jobs where job_type='safe_arrival.lifecycle_notification' and status='retrying'),
 'deadLetterNotificationJobs',(select count(*) from public.jobs where job_type='safe_arrival.lifecycle_notification' and status='dead_letter'),
 'oldestPendingIntent',(select min(created_at) from public.jobs where job_type='safe_arrival.lifecycle_notification' and status in('queued','scheduled','retrying')),
 'recentTransitionConflicts',(select count(*) from public.safe_arrival_events where event_type='transition_conflict' and created_at>now()-interval '24 hours')
) from public.safe_arrival_sessions; $$;

revoke all on function public.safe_arrival_relationship_current(uuid,uuid) from public,anon,authenticated;
revoke all on function public.can_view_safe_arrival_session(uuid,boolean) from public;
grant execute on function public.can_view_safe_arrival_session(uuid,boolean) to anon,authenticated,service_role;
revoke all on function public.enqueue_safe_arrival_notifications(uuid,text,uuid[],uuid,text) from public,anon,authenticated;
revoke all on function public.start_safe_arrival(uuid,text,timestamptz,integer,text,uuid[],integer) from public,anon,authenticated;
revoke all on function public.transition_safe_arrival(uuid,uuid,text,integer) from public,anon,authenticated;
revoke all on function public.process_due_safe_arrivals(integer) from public,anon,authenticated;
revoke all on function public.admin_safe_arrival_health() from public,anon,authenticated;
grant execute on function public.start_safe_arrival(uuid,text,timestamptz,integer,text,uuid[],integer) to service_role;
grant execute on function public.transition_safe_arrival(uuid,uuid,text,integer) to service_role;
grant execute on function public.process_due_safe_arrivals(integer) to service_role;
grant execute on function public.admin_safe_arrival_health() to service_role;
