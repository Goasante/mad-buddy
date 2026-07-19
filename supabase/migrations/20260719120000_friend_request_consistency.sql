-- Keep friend requests and friendships as one consistent relationship state.

-- Repair stale pending requests for pairs that are already friends.
update public.friend_requests as request
set
  status = 'accepted',
  responded_at = coalesce(request.responded_at, now()),
  updated_at = now()
where request.status = 'pending'
  and exists (
    select 1
    from public.friendships as friendship
    where friendship.user_one_id = least(request.sender_id, request.receiver_id)
      and friendship.user_two_id = greatest(request.sender_id, request.receiver_id)
  );

-- Older flows could create one pending request in each direction. Keep the
-- oldest actionable request and settle the duplicate before adding the pair
-- level uniqueness constraint.
with ranked_pending as (
  select
    id,
    row_number() over (
      partition by least(sender_id, receiver_id), greatest(sender_id, receiver_id)
      order by created_at asc, id asc
    ) as pair_rank
  from public.friend_requests
  where status = 'pending'
)
update public.friend_requests as request
set status = 'cancelled', responded_at = now(), updated_at = now()
from ranked_pending
where request.id = ranked_pending.id
  and ranked_pending.pair_rank > 1;

create unique index if not exists friend_requests_one_pending_per_pair
  on public.friend_requests(least(sender_id, receiver_id), greatest(sender_id, receiver_id))
  where status = 'pending';

create or replace function public.prevent_pending_request_for_existing_friendship()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'pending' and exists (
    select 1
    from public.friendships as friendship
    where friendship.user_one_id = least(new.sender_id, new.receiver_id)
      and friendship.user_two_id = greatest(new.sender_id, new.receiver_id)
  ) then
    raise exception 'users_are_already_friends' using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists friend_requests_prevent_existing_friendship on public.friend_requests;
create trigger friend_requests_prevent_existing_friendship
before insert or update of sender_id, receiver_id, status on public.friend_requests
for each row execute function public.prevent_pending_request_for_existing_friendship();

create or replace function public.accept_friend_request(p_request_id uuid)
returns table(sender_id uuid, receiver_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  request_row public.friend_requests%rowtype;
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  select request.*
  into request_row
  from public.friend_requests as request
  where request.id = p_request_id
    and request.receiver_id = current_user_id
    and request.status = 'pending'
  for update;

  if not found then
    raise exception 'request_not_pending' using errcode = 'P0002';
  end if;

  insert into public.friendships (
    user_one_id,
    user_two_id,
    accepted_request_id,
    ended_at
  )
  values (
    least(request_row.sender_id, request_row.receiver_id),
    greatest(request_row.sender_id, request_row.receiver_id),
    request_row.id,
    null
  )
  on conflict (user_one_id, user_two_id)
  do update set
    accepted_request_id = excluded.accepted_request_id,
    ended_at = null;

  -- Settle every pending request for the pair, including legacy reciprocal or
  -- duplicate rows, in the same transaction as the friendship.
  update public.friend_requests as request
  set status = 'accepted', responded_at = now(), updated_at = now()
  where request.status = 'pending'
    and least(request.sender_id, request.receiver_id) = least(request_row.sender_id, request_row.receiver_id)
    and greatest(request.sender_id, request.receiver_id) = greatest(request_row.sender_id, request_row.receiver_id);

  return query select request_row.sender_id, request_row.receiver_id;
end;
$$;

revoke all on function public.accept_friend_request(uuid) from public;
grant execute on function public.accept_friend_request(uuid) to authenticated;
