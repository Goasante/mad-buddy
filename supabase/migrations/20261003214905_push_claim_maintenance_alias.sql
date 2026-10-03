create or replace function public.claim_notification_push(p_dispatch_id uuid default null,p_limit integer default 20)
returns table(id uuid,dispatch_id uuid,transport text,target_id uuid,attempts integer,lease_id uuid,
  user_id uuid,payload jsonb,context jsonb,expires_at timestamptz)
language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  -- Bounded retention. Keep semantic dedupe records for seven days; retain
  -- the ordinary in-app notification ledger independently.
  if p_dispatch_id is null then
  delete from public.notification_dispatches stale where stale.id in (
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
