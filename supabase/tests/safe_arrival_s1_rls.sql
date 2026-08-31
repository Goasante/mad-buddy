begin;
do $$
declare
 t uuid:='10000000-0000-0000-0000-000000000001'; accepted uuid:='10000000-0000-0000-0000-000000000002';
 invited uuid:='10000000-0000-0000-0000-000000000003'; declined uuid:='10000000-0000-0000-0000-000000000004';
 unrelated uuid:='10000000-0000-0000-0000-000000000005'; s uuid; n integer;
begin
 insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
 select x,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',x||'@local.test',crypt('x',gen_salt('bf')),now(),now(),now()
 from unnest(array[t,accepted,invited,declined,unrelated]) x on conflict(id) do nothing;
 insert into public.friendships(user_one_id,user_two_id) values(t,accepted),(t,invited),(t,declined)
 on conflict(user_one_id,user_two_id) do update set ended_at=null;
 insert into public.safe_arrival_sessions(traveller_id,destination_label,expected_arrival_at,status)
 values(t,'Campus',now()+interval '1 hour','active') returning id into s;
 insert into public.safe_arrival_contacts(session_id,contact_user_id,acknowledgement_status)
 values(s,accepted,'watching'),(s,invited,'pending'),(s,declined,'declined');
 execute 'set local role authenticated';
 perform set_config('request.jwt.claim.sub',t::text,true); select count(*) into n from public.safe_arrival_sessions where id=s;
 if n<>1 then raise exception 'RLS TRAVELLER FAIL'; end if;
 perform set_config('request.jwt.claim.sub',accepted::text,true); select count(*) into n from public.safe_arrival_sessions where id=s;
 if n<>1 then raise exception 'RLS ACCEPTED WATCHER FAIL'; end if;
 perform set_config('request.jwt.claim.sub',invited::text,true); select count(*) into n from public.safe_arrival_sessions where id=s;
 if n<>1 then raise exception 'RLS INVITED WATCHER FAIL'; end if;
 perform set_config('request.jwt.claim.sub',declined::text,true); select count(*) into n from public.safe_arrival_sessions where id=s;
 if n<>0 then raise exception 'RLS DECLINED WATCHER FAIL'; end if;
 perform set_config('request.jwt.claim.sub',unrelated::text,true); select count(*) into n from public.safe_arrival_sessions where id=s;
 if n<>0 then raise exception 'RLS UNRELATED FAIL'; end if;
 begin
   update public.safe_arrival_sessions set destination_label='tampered' where id=s;
   raise exception 'RLS DIRECT SESSION WRITE FAIL';
 exception when insufficient_privilege then null; end;
 begin
   insert into public.safe_arrival_events(session_id,event_type,created_by) values(s,'confirmed',unrelated);
   raise exception 'RLS DIRECT EVENT WRITE FAIL';
 exception when insufficient_privilege then null; end;
 reset role; execute 'set local role service_role';
 select count(*) into n from public.safe_arrival_sessions where id=s;
 if n<>1 then raise exception 'RLS SERVICE ROLE FAIL'; end if;
 reset role; insert into public.safe_arrival_blocks(user_id,blocked_traveller_id) values(invited,t);
 execute 'set local role authenticated'; perform set_config('request.jwt.claim.sub',invited::text,true);
 select count(*) into n from public.safe_arrival_sessions where id=s; if n<>1 then raise exception 'RLS MUTE MUST NOT REVOKE CURRENT JOURNEY FAIL'; end if;
 reset role; delete from public.safe_arrival_blocks where user_id=invited and blocked_traveller_id=t;
 reset role; insert into public.blocked_users(blocker_id,blocked_id) values(accepted,t);
 execute 'set local role authenticated'; perform set_config('request.jwt.claim.sub',accepted::text,true);
 select count(*) into n from public.safe_arrival_sessions where id=s; if n<>0 then raise exception 'RLS BLOCK REVOCATION FAIL'; end if;
 reset role; delete from public.blocked_users where blocker_id=accepted and blocked_id=t;
 update public.friendships set ended_at=now() where user_one_id=t and user_two_id=accepted;
 execute 'set local role authenticated'; perform set_config('request.jwt.claim.sub',accepted::text,true);
 select count(*) into n from public.safe_arrival_sessions where id=s; if n<>0 then raise exception 'RLS UNFRIEND REVOCATION FAIL'; end if;
end $$;
rollback;
