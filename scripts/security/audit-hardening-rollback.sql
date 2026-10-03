-- STAGING ONLY. All synthetic data and deletions are rolled back.
-- Run against the isolated staging project after the audit-hardening migration.
begin;
do $test$
declare
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  outsider uuid := gen_random_uuid();
  chat uuid := gen_random_uuid();
  message uuid := gen_random_uuid();
  request_id uuid := gen_random_uuid();
  image uuid := gen_random_uuid();
  blocked_rejected boolean := false;
  bootstrap_rejected boolean := false;
  upload_rejected boolean := false;
  event_edit_rejected boolean := false;
  event_delete_rejected boolean := false;
  event_actor_rejected boolean := false;
begin
  insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data,aud,role)
  values(a,a::text || '@audit-hardening.invalid','{}','{}','authenticated','authenticated'),
        (b,b::text || '@audit-hardening.invalid','{}','{}','authenticated','authenticated'),
        (outsider,outsider::text || '@audit-hardening.invalid','{}','{}','authenticated','authenticated');
  insert into public.profiles(user_id,full_name,username)
  values(a,'Synthetic audit A','audit_' || substr(a::text,1,8)),
        (b,'Synthetic audit B','audit_' || substr(b::text,1,8)),
        (outsider,'Synthetic outsider','audit_' || substr(outsider::text,1,8));
  insert into public.conversations(id,conversation_type,created_by) values(chat,'group',a);
  insert into public.conversation_members(conversation_id,user_id,role,status)
  values(chat,a,'owner','joined'),(chat,b,'member','joined');
  insert into public.messages(id,conversation_id,sender_id,message_type,text_content)
  values(message,chat,a,'text','Synthetic content');
  perform set_config('request.jwt.claim.sub',a::text,true);
  if not public.chat_poll_parent_is_live(message) then raise exception 'member lost poll helper access'; end if;
  perform set_config('request.jwt.claim.sub',outsider::text,true);
  if public.chat_poll_parent_is_live(message) then raise exception 'outsider learned message status'; end if;

  insert into public.friend_requests(id,sender_id,receiver_id,status) values(request_id,a,b,'pending');
  perform set_config('request.jwt.claim.sub',b::text,true);
  perform public.accept_friend_request(request_id);
  if not exists(select 1 from public.friendships where user_one_id=least(a,b) and user_two_id=greatest(a,b) and ended_at is null)
  then raise exception 'ordinary friend acceptance regressed'; end if;
  insert into public.blocked_users(blocker_id,blocked_id) values(a,b);
  if exists(select 1 from public.friendships where user_one_id=least(a,b) and user_two_id=greatest(a,b) and ended_at is null)
  then raise exception 'block did not end friendship'; end if;
  -- A legacy pending request must not reactivate a blocked friendship.
  insert into public.friend_requests(sender_id,receiver_id,status) values(a,b,'pending') returning id into request_id;
  begin
    perform public.accept_friend_request(request_id);
  exception when insufficient_privilege then blocked_rejected := true;
  end;
  if not blocked_rejected then raise exception 'blocked request accepted'; end if;

  if not public.reserve_notification_budget(a,'2026-10-03',1) then raise exception 'first budget reservation failed'; end if;
  if public.reserve_notification_budget(a,'2026-10-03',1) then raise exception 'budget exceeded'; end if;
  if not public.reserve_notification_budget(b,'2026-10-03',1) then raise exception 'another user budget affected'; end if;
  if has_function_privilege('authenticated','public.reserve_notification_budget(uuid,text,integer)','execute')
  then raise exception 'browser can reserve another user budget'; end if;

  insert into public.media_assets(id,owner_id,storage_key,content_type,size_bytes,context_type,intended_conversation_id,intended_media_kind)
  values(image,a,a::text || '/chat/audit.jpg','image/jpeg',100,'chat',chat,'image');
  insert into public.messages(conversation_id,sender_id,message_type,media_id)
  values(chat,a,'image',image);
  insert into public.account_deletion_requests(user_id) values(a);
  begin
    insert into public.profiles(user_id,full_name,username) values(a,'Recreated','audit_recreated');
  exception when insufficient_privilege then bootstrap_rejected := true;
  end;
  if not bootstrap_rejected then raise exception 'deletion profile bootstrap allowed'; end if;
  begin
    insert into public.media_assets(owner_id,storage_key,content_type,size_bytes,context_type)
    values(a,a::text || '/chat/new.jpg','image/jpeg',100,'chat');
  exception when insufficient_privilege then upload_rejected := true;
  end;
  if not upload_rejected then raise exception 'deletion upload intent allowed'; end if;

  begin
    update public.domain_events set payload='{}' where actor_id=a;
  exception when raise_exception then event_edit_rejected := true;
  end;
  begin
    delete from public.domain_events where actor_id=a;
  exception when raise_exception then event_delete_rejected := true;
  end;
  begin
    update public.domain_events set actor_id=null where actor_id=a;
  exception when raise_exception then event_actor_rejected := true;
  end;
  if not event_edit_rejected or not event_delete_rejected or not event_actor_rejected
  then raise exception 'append-only protection weakened'; end if;

  -- The production workflow's tombstone-before-Auth operation: detach media
  -- without weakening the attachment validator or deleting other members.
  update public.messages set status='deleted',deleted_at=now(),text_content=null,media_id=null,waveform_data=null where sender_id=a;
  delete from auth.users where id=a;
  if exists(select 1 from auth.users where id=a) then raise exception 'synthetic Auth user remained'; end if;
  if not exists(select 1 from auth.users where id=b) then raise exception 'other user removed'; end if;
  if not exists(select 1 from public.conversations where id=chat) then raise exception 'shared thread removed'; end if;
  if exists(select 1 from public.messages where conversation_id=chat and (text_content is not null or media_id is not null))
  then raise exception 'deleted user content remained'; end if;
end;
$test$;
rollback;
select 'PASS: member/outsider, block precedence, budget isolation, deletion guards, synthetic Auth cascade; all fixture changes rolled back' as result;
