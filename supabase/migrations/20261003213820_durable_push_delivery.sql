-- Private server outbox. Device addresses/keys remain in their existing tables.
create table public.notification_dispatches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  dedupe_key text,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  context jsonb not null default '{}',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '1 hour',
  unique(user_id, dedupe_key)
);
create index notification_dispatches_expiry_idx on public.notification_dispatches(expires_at);
create table public.notification_push_deliveries (
  id uuid primary key default gen_random_uuid(),
  dispatch_id uuid not null references public.notification_dispatches(id) on delete cascade,
  transport text not null check(transport in ('web','native')),
  target_id uuid not null,
  status text not null default 'queued' check(status in ('queued','processing','delivered','failed','expired','suppressed')),
  attempts integer not null default 0 check(attempts between 0 and 5),
  run_at timestamptz not null default now(),
  locked_at timestamptz,
  lease_id uuid,
  last_error text,
  unique(dispatch_id, transport, target_id)
);
create index notification_push_deliveries_due_idx on public.notification_push_deliveries(run_at)
  where status in ('queued','processing');
alter table public.notification_dispatches enable row level security;
alter table public.notification_push_deliveries enable row level security;
revoke all on public.notification_dispatches, public.notification_push_deliveries from public,anon,authenticated;
grant select,insert,update,delete on public.notification_dispatches, public.notification_push_deliveries to service_role;

-- In-app persistence, one budget reservation and all target rows commit together.
-- Existing notification dedupe keys keep their semantics, including old events.
create function public.enqueue_notification_dispatch(
  p_user_id uuid,p_type text,p_title text,p_message text,p_dedupe_key text,
  p_persist boolean,p_push boolean,p_day_key text,p_budget integer,p_bypass_budget boolean,
  p_payload jsonb,p_context jsonb
) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare dispatch uuid; notification uuid; queued integer := 0; n integer; budget_ok boolean := true;
begin
  if exists(select 1 from public.account_deletion_requests where user_id=p_user_id)
    or not exists(select 1 from public.profiles where user_id=p_user_id) then
    return jsonb_build_object('inApp',false,'push',false,'reason','recipient_unavailable');
  end if;
  insert into public.notification_dispatches(user_id,dedupe_key,payload,context)
  values(p_user_id,p_dedupe_key,p_payload,p_context)
  on conflict(user_id,dedupe_key) do nothing returning id into dispatch;
  if dispatch is null then
    return jsonb_build_object('inApp',p_persist,'push',false,'reason','duplicate');
  end if;
  if p_persist then
    insert into public.notifications(user_id,type,title,message,is_read,dedupe_key)
    values(p_user_id,p_type,p_title,p_message,false,p_dedupe_key)
    on conflict do nothing returning id into notification;
    if notification is null then
      delete from public.notification_dispatches where id=dispatch;
      return jsonb_build_object('inApp',true,'push',false,'reason','duplicate');
    end if;
  end if;
  if p_push and not p_bypass_budget then
    budget_ok := public.reserve_notification_budget(p_user_id,p_day_key,p_budget);
  end if;
  if p_push and budget_ok then
    insert into public.notification_push_deliveries(dispatch_id,transport,target_id)
      select dispatch,'web',id from public.push_subscriptions where user_id=p_user_id;
    get diagnostics queued = row_count;
    insert into public.notification_push_deliveries(dispatch_id,transport,target_id)
      select dispatch,'native',id from public.device_push_tokens where user_id=p_user_id;
    get diagnostics n = row_count; queued := queued+n;
  end if;
  return jsonb_build_object('dispatchId',dispatch,'inApp',p_persist,'push',queued>0,
    'reason',case when not budget_ok then 'budget_exhausted' when queued=0 then 'no_subscription' else 'queued' end);
end;
$$;
revoke all on function public.enqueue_notification_dispatch(uuid,text,text,text,text,boolean,boolean,text,integer,boolean,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.enqueue_notification_dispatch(uuid,text,text,text,text,boolean,boolean,text,integer,boolean,jsonb,jsonb) to service_role;

-- SKIP LOCKED gives immediate and recovery workers disjoint target rows.
-- Lease fencing prevents a late worker from overwriting its replacement.
create function public.claim_notification_push(p_dispatch_id uuid default null,p_limit integer default 20)
returns table(id uuid,dispatch_id uuid,transport text,target_id uuid,attempts integer,lease_id uuid,
  user_id uuid,payload jsonb,context jsonb,expires_at timestamptz)
language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  -- Bounded retention. Keep semantic dedupe records for seven days; retain
  -- the ordinary in-app notification ledger independently.
  if p_dispatch_id is null then
  delete from public.notification_dispatches where id in (
    select d.id from public.notification_dispatches d where d.expires_at < now()-interval '6 days'
    order by d.expires_at limit 200
  );
  update public.notification_push_deliveries q set
    status=case when d.expires_at<=now() then 'expired' else 'failed' end,
    locked_at=null,lease_id=null
  from public.notification_dispatches d where q.dispatch_id=d.id and q.id in (
    select x.id from public.notification_push_deliveries x join public.notification_dispatches p on p.id=x.dispatch_id
    where x.status in ('queued','processing') and (p.expires_at<=now()
      or (x.attempts>=5 and (x.locked_at is null or x.locked_at<now()-interval '5 minutes')))
    limit 200
  );
  end if;
  return query
  with candidates as (
    select q.id from public.notification_push_deliveries q join public.notification_dispatches d on d.id=q.dispatch_id
    where (p_dispatch_id is null or q.dispatch_id=p_dispatch_id)
      and q.attempts<5 and d.expires_at>now()
      and not exists(select 1 from public.account_deletion_requests a where a.user_id=d.user_id)
      and ((q.status='queued' and q.run_at<=now())
        or (q.status='processing' and q.locked_at<now()-interval '5 minutes'))
    order by case when d.context->>'priority'='critical' then 0 when d.context->>'priority'='high' then 1 else 2 end,q.run_at
    limit greatest(1,least(coalesce(p_limit,20),20)) for update of q skip locked
  ), claimed as (
    update public.notification_push_deliveries q set status='processing',attempts=q.attempts+1,
      locked_at=now(),lease_id=gen_random_uuid() from candidates c where q.id=c.id returning q.*
  )
  select c.id,c.dispatch_id,c.transport,c.target_id,c.attempts,c.lease_id,d.user_id,d.payload,d.context,d.expires_at
  from claimed c join public.notification_dispatches d on d.id=c.dispatch_id;
end;
$$;
revoke all on function public.claim_notification_push(uuid,integer) from public,anon,authenticated;
grant execute on function public.claim_notification_push(uuid,integer) to service_role;

create function public.finish_notification_push(p_id uuid,p_lease_id uuid,p_outcome text,p_error text default null)
returns boolean language plpgsql security invoker set search_path=public,pg_temp as $$
declare changed integer;
begin
  if p_outcome not in ('delivered','retry','failed','suppressed') then raise exception 'Invalid push outcome'; end if;
  update public.notification_push_deliveries q set
    status=case when p_outcome='retry' then
      case when d.expires_at<=now() then 'expired' when q.attempts>=5 then 'failed' else 'queued' end
      else p_outcome end,
    run_at=case when p_outcome='retry' then now()+make_interval(secs=>least(30*power(2,q.attempts-1)::integer,600)) else q.run_at end,
    locked_at=null,lease_id=null,last_error=left(p_error,80)
  from public.notification_dispatches d
  where q.id=p_id and q.dispatch_id=d.id and q.lease_id=p_lease_id and q.status='processing';
  get diagnostics changed = row_count; return changed=1;
end;
$$;
revoke all on function public.finish_notification_push(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.finish_notification_push(uuid,uuid,text,text) to service_role;
