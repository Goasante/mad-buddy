-- STAGING ONLY. No real notifications are sent. All fixtures roll back.
begin;
do $test$
declare
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid();
  first jsonb; replay jsonb; exhausted jsonb; urgent jsonb;
  dispatch uuid; target record; replacement record; count_rows integer;
  old_lease uuid; old_target uuid; failed boolean := false;
begin
  insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data,aud,role)
    values(a,a::text||'@push-outbox.invalid','{}','{}','authenticated','authenticated'),
          (b,b::text||'@push-outbox.invalid','{}','{}','authenticated','authenticated');
  insert into public.profiles(user_id,full_name,username)
    values(a,'Synthetic push A','push_'||substr(a::text,1,8)),(b,'Synthetic push B','push_'||substr(b::text,1,8));
  insert into public.push_subscriptions(user_id,endpoint,p256dh,auth)
    values(a,'https://push.invalid/'||gen_random_uuid(),'synthetic','synthetic'),
          (a,'https://push.invalid/'||gen_random_uuid(),'synthetic','synthetic'),
          (b,'https://push.invalid/'||gen_random_uuid(),'synthetic','synthetic');
  insert into public.device_push_tokens(user_id,token,platform) values(a,gen_random_uuid()::text,'android');
  if has_function_privilege('authenticated','public.claim_notification_push(uuid,integer)','execute')
    or has_table_privilege('authenticated','public.notification_dispatches','select')
    or has_function_privilege('anon','public.enqueue_notification_dispatch(uuid,text,text,text,text,boolean,boolean,text,integer,boolean,jsonb,jsonb)','execute')
    then raise exception 'Browser outbox access granted'; end if;
  execute 'set local role service_role';
  first := public.enqueue_notification_dispatch(a,'system_alert','Test','Synthetic','outbox:'||a,true,true,'2026-10-03',1,false,
    '{"title":"Mad Buddy","body":"Private update","url":"/notifications"}','{"priority":"normal"}');
  dispatch := (first->>'dispatchId')::uuid;
  if not (first->>'push')::boolean then raise exception 'Queue did not persist'; end if;
  select count(*) into count_rows from public.notification_push_deliveries where dispatch_id=dispatch;
  if count_rows<>3 then raise exception 'Target snapshot wrong: %',count_rows; end if;
  replay := public.enqueue_notification_dispatch(a,'system_alert','Test','Synthetic','outbox:'||a,true,true,'2026-10-03',1,false,
    '{"title":"Mad Buddy","body":"Private update","url":"/notifications"}','{}');
  if replay->>'reason'<>'duplicate' then raise exception 'Semantic duplicate escaped'; end if;
  if (select sent_count from public.notification_budget_usage where user_id=a and day_key='2026-10-03')<>1
    then raise exception 'Replay reserved again'; end if;
  exhausted := public.enqueue_notification_dispatch(a,'system_alert','Test','Synthetic','exhausted:'||a,true,true,'2026-10-03',1,false,
    '{"title":"Mad Buddy","body":"Private update","url":"/notifications"}','{}');
  if exhausted->>'reason'<>'budget_exhausted' or not (exhausted->>'inApp')::boolean
    then raise exception 'Budget exhaustion lost in-app delivery'; end if;
  urgent := public.enqueue_notification_dispatch(a,'system_alert','Test','Synthetic','urgent:'||a,false,true,'2026-10-03',1,true,
    '{"title":"Mad Buddy","body":"Private update","url":"/notifications"}','{"priority":"critical"}');
  if not (urgent->>'push')::boolean then raise exception 'Critical bypass broken'; end if;
  -- A failed transaction must leave neither dispatch nor in-app notification.
  begin
    perform public.enqueue_notification_dispatch(a,'system_alert','Test',null,'invalid:'||a,true,true,'2026-10-03',8,false,
      '{"title":"Mad Buddy","body":"Private update","url":"/notifications"}','{}');
  exception when not_null_violation then failed:=true;
  end;
  if not failed or exists(select 1 from public.notification_dispatches where dedupe_key='invalid:'||a)
    then raise exception 'Failed transaction left partial outbox'; end if;
  -- Claim two targets, accept one and retry the other; the third stays queued.
  for target in select * from public.claim_notification_push(dispatch,2) loop
    if old_target is null then
      if not public.finish_notification_push(target.id,target.lease_id,'delivered',null) then raise exception 'Ack failed'; end if;
      old_target:=target.id;
    else
      if not public.finish_notification_push(target.id,target.lease_id,'retry','synthetic timeout') then raise exception 'Retry ack failed'; end if;
    end if;
  end loop;
  if (select count(*) from public.claim_notification_push(dispatch,20))<>1 then raise exception 'Reclaimed already-delivered/backoff targets'; end if;
  select * into target from public.notification_push_deliveries where dispatch_id=dispatch and status='processing';
  old_lease:=target.lease_id;
  update public.notification_push_deliveries set locked_at=now()-interval '6 minutes' where id=target.id;
  select * into replacement from public.claim_notification_push(dispatch,20);
  if replacement.id is null or replacement.lease_id=old_lease then raise exception 'Stale claim was not recovered'; end if;
  if public.finish_notification_push(target.id,old_lease,'delivered',null) then raise exception 'Old lease overwrote replacement'; end if;
  if not public.finish_notification_push(replacement.id,replacement.lease_id,'delivered',null) then raise exception 'Replacement ack failed'; end if;
  update public.notification_push_deliveries set run_at=now()-interval '1 minute' where dispatch_id=dispatch and status='queued';
  for target in select * from public.claim_notification_push(dispatch,20) loop
    update public.notification_push_deliveries set attempts=5 where id=target.id;
    perform public.finish_notification_push(target.id,target.lease_id,'retry','synthetic timeout');
  end loop;
  if exists(select 1 from public.notification_push_deliveries where dispatch_id=dispatch and status='queued') then raise exception 'Exhausted target retries forever'; end if;
  update public.notification_dispatches set expires_at=now()-interval '1 minute' where id=(urgent->>'dispatchId')::uuid;
  if (select count(*) from public.claim_notification_push((urgent->>'dispatchId')::uuid,20))<>0 then raise exception 'Expired notification sent'; end if;
  insert into public.account_deletion_requests(user_id) values(a);
  delete from public.notification_dispatches where user_id=a;
  if exists(select 1 from public.notification_push_deliveries where dispatch_id=dispatch) then raise exception 'Deletion left push targets'; end if;
  replay := public.enqueue_notification_dispatch(a,'system_alert','Test','Synthetic','deleting:'||a,true,true,'2026-10-03',8,true,
    '{"title":"Mad Buddy","body":"Private update","url":"/notifications"}','{}');
  if replay->>'reason'<>'recipient_unavailable' then raise exception 'Deleting account accepted push'; end if;
  -- Exercise the global recovery/retention branch as the real service role.
  perform public.claim_notification_push(null,20);
  execute 'reset role';
end;
$test$;
rollback;
select 'PASS: atomic persistence, dedupe, budget, partial device retry, backoff, lease fencing, expiry, deletion, service-only access; all fixtures rolled back' as result;
