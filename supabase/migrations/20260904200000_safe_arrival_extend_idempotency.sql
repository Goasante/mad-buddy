-- ---------------------------------------------------------------------------
-- One extension intent must produce exactly one extension.
--
-- Extend is deliberately CUMULATIVE: two separate decisions to add ten minutes
-- should add twenty. But two activations of the SAME decision -- a double tap
-- before the pending state renders, a retried request, a replayed action --
-- were also adding twenty, because the transition carried no mutation
-- identity. Proven locally against unmodified authority: two concurrent
-- extend calls moved expected_arrival_at by 20 minutes and wrote two
-- `extended` events; replaying a committed call did the same.
--
-- That matters more here than on an ordinary button. expected_arrival_at is
-- the clock that decides when contacts are told somebody has not arrived, so a
-- duplicate extension silently postpones the alert.
--
-- The fix gives one intent one id, and makes claiming that id part of the same
-- transaction that moves the clock.
-- ---------------------------------------------------------------------------

-- The canonical audit trail is already the right home: every extension writes
-- an `extended` row, so the claim and the evidence cannot drift apart.
alter table public.safe_arrival_events
  add column if not exists client_mutation_id uuid;

comment on column public.safe_arrival_events.client_mutation_id is
  'Opaque per-intent id for replay protection. One user intent = one id = one canonical mutation. NULL for historical rows and for server-initiated events, which carry no client intent. Contains no location, destination, distance or watcher data. See 20260904200000.';

-- PARTIAL, so the column stays optional: historical events and every
-- server-initiated event keep a NULL id without colliding with each other.
create unique index if not exists safe_arrival_events_client_mutation_idx
  on public.safe_arrival_events(session_id, event_type, client_mutation_id)
  where client_mutation_id is not null;

-- ---------------------------------------------------------------------------
-- The transition, now idempotent for extend.
--
-- Unchanged from 20260830223000 except: the new p_client_mutation_id argument
-- (defaulted, so existing callers keep working), the claim inside the extend
-- branch, and the notification suppression on a replay.
-- ---------------------------------------------------------------------------
create or replace function public.transition_safe_arrival(
  p_session_id uuid, p_actor_id uuid, p_action text, p_extra_minutes integer default null,
  p_client_mutation_id uuid default null
) returns table(session_id uuid, canonical_status text, changed boolean, expected_arrival_at timestamptz)
language plpgsql security definer set search_path = public as $$
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

-- REVOKE strips service_role too, so the server's own grant is restated.
grant execute on function public.transition_safe_arrival(uuid, uuid, text, integer, uuid) to service_role;
