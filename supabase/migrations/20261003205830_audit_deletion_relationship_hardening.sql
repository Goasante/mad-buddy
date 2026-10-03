-- Version aligned with the staging migration history after verification.
-- Additive guards only: no historical account or content is deleted here.
-- Existing clients retain the same RPC signatures and return shapes.

create or replace function public.chat_poll_parent_is_live(p_message_id uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null and exists (
    select 1 from public.messages m
    where m.id = p_message_id and m.deleted_at is null and m.status <> 'deleted'
      and public.is_conversation_member(m.conversation_id)
  );
$$;
revoke all on function public.chat_poll_parent_is_live(uuid) from public;
grant execute on function public.chat_poll_parent_is_live(uuid) to anon, authenticated, service_role;

-- Serialize block and acceptance on the SAME canonical pair, before either
-- takes request/friendship row locks. Different pairs do not block each other.
create or replace function public.lock_block_relationship_pair()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(
    'relationship:' || least(new.blocker_id,new.blocked_id)::text || ':' || greatest(new.blocker_id,new.blocked_id)::text, 0));
  return new;
end;
$$;
revoke all on function public.lock_block_relationship_pair() from public, anon, authenticated;
create trigger blocked_users_lock_relationship_pair
before insert or update on public.blocked_users
for each row execute function public.lock_block_relationship_pair();

create or replace function public.end_blocked_relationship()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  update public.friendships set ended_at = now()
  where user_one_id = least(new.blocker_id,new.blocked_id)
    and user_two_id = greatest(new.blocker_id,new.blocked_id) and ended_at is null;
  update public.friend_requests set status = 'blocked', responded_at = now(), updated_at = now()
  where status = 'pending' and (
    (sender_id = new.blocker_id and receiver_id = new.blocked_id)
    or (sender_id = new.blocked_id and receiver_id = new.blocker_id));
  delete from public.close_friend_relationships
  where (owner_id = new.blocker_id and friend_id = new.blocked_id)
    or (owner_id = new.blocked_id and friend_id = new.blocker_id);
  return new;
end;
$$;
revoke all on function public.end_blocked_relationship() from public, anon, authenticated;
create trigger blocked_users_end_relationship
after insert or update on public.blocked_users
for each row execute function public.end_blocked_relationship();

create or replace function public.accept_friend_request(p_request_id uuid)
returns table(sender_id uuid, receiver_id uuid, reactivated boolean)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  request_row public.friend_requests%rowtype;
  current_user_id uuid := auth.uid();
  pair_one uuid;
  pair_two uuid;
  was_ended boolean := false;
begin
  if current_user_id is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;
  select request.* into request_row from public.friend_requests request
  where request.id=p_request_id and request.receiver_id=current_user_id and request.status='pending';
  if not found then raise exception 'request_not_pending' using errcode='P0002'; end if;
  pair_one := least(request_row.sender_id,request_row.receiver_id);
  pair_two := greatest(request_row.sender_id,request_row.receiver_id);
  perform pg_advisory_xact_lock(hashtextextended('relationship:' || pair_one::text || ':' || pair_two::text,0));
  -- Re-read after acquiring the pair lock: a block/accept may have settled it.
  select request.* into request_row from public.friend_requests request
  where request.id=p_request_id and request.receiver_id=current_user_id and request.status='pending' for update;
  if not found then raise exception 'request_not_pending' using errcode='P0002'; end if;
  if exists(select 1 from public.blocked_users b where
    (b.blocker_id=pair_one and b.blocked_id=pair_two) or (b.blocker_id=pair_two and b.blocked_id=pair_one)) then
    raise exception 'relationship_blocked' using errcode='42501';
  end if;
  select (f.ended_at is not null) into was_ended from public.friendships f
  where f.user_one_id=pair_one and f.user_two_id=pair_two for update;
  if not found then was_ended := false; end if;
  insert into public.friendships(user_one_id,user_two_id,accepted_request_id,ended_at)
  values(pair_one,pair_two,request_row.id,null)
  on conflict(user_one_id,user_two_id) do update set accepted_request_id=excluded.accepted_request_id,ended_at=null;
  update public.friend_requests request set status='accepted',responded_at=now(),updated_at=now()
  where request.status='pending' and least(request.sender_id,request.receiver_id)=pair_one
    and greatest(request.sender_id,request.receiver_id)=pair_two;
  return query select request_row.sender_id,request_row.receiver_id,was_ended;
end;
$$;
revoke all on function public.accept_friend_request(uuid) from public, anon;
grant execute on function public.accept_friend_request(uuid) to authenticated;

-- Prevent bootstrap/upload intents from resurrecting a deleting account.
-- This applies to privileged server writes too, not only browser policies.
create or replace function public.guard_deleting_account_insert()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  target_user uuid;
begin
  if tg_table_name='profiles' then target_user := new.user_id;
  elsif tg_table_name='media_assets' then target_user := new.owner_id;
  else raise exception 'unsupported deletion guard table'; end if;
  if exists(select 1 from public.account_deletion_requests d where d.user_id=target_user) then
    raise exception 'account_deletion_in_progress' using errcode='42501';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_deleting_account_insert() from public, anon, authenticated;
create trigger profiles_guard_deletion_insert before insert on public.profiles
for each row execute function public.guard_deleting_account_insert();
create trigger media_assets_guard_deletion_insert before insert on public.media_assets
for each row execute function public.guard_deleting_account_insert();

-- Service-only atomic reservation; ordinary notification budgets cannot lose
-- increments during parallel delivery. Critical/high bypass remains in code.
create or replace function public.reserve_notification_budget(p_user_id uuid,p_day_key text,p_budget integer)
returns boolean language plpgsql security definer set search_path = public, pg_temp
as $$
declare reserved integer;
begin
  if p_budget is null or p_budget < 1 or p_budget > 8 or p_day_key !~ '^\d{4}-\d{2}-\d{2}$' then return false; end if;
  insert into public.notification_budget_usage(user_id,day_key,sent_count)
  values(p_user_id,p_day_key,1)
  on conflict(user_id,day_key) do update set sent_count=public.notification_budget_usage.sent_count+1,updated_at=now()
  where public.notification_budget_usage.sent_count < p_budget
  returning sent_count into reserved;
  return reserved is not null;
end;
$$;
revoke all on function public.reserve_notification_budget(uuid,text,integer) from public, anon, authenticated;
grant execute on function public.reserve_notification_budget(uuid,text,integer) to service_role;
