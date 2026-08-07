-- Phase 3.2B — relationship lifecycle activation.
--
-- Phase 3.2A made `ended_at IS NULL` authoritative for READS. This completes
-- the lifecycle on the WRITE side: a friendship can end, and a friendship can
-- restart, without the pair's canonical identity ever changing.
--
-- Two defects block that today, both of which treat "a row exists" as "they
-- are friends" — the exact conflation 3.2A removed from the read paths:
--
--   1. `prevent_pending_request_for_existing_friendship` rejects a friend
--      request whenever ANY friendships row exists for the pair. After a soft
--      ending the row still exists, so two people who unfriend can never send
--      each other a request again. Reactivation is currently unreachable.
--
--   2. `accept_friend_request`'s conflict branch clears `ended_at` (correct)
--      but does not distinguish a first acceptance from a reactivation, so
--      nothing downstream can tell which happened.
--
-- Identity is already guaranteed by the existing schema and is deliberately
-- NOT re-implemented here:
--   * `friendships_ordered`     check (user_one_id < user_two_id)
--   * `friendships_unique_pair` unique (user_one_id, user_two_id)
-- Together these make exactly one row per pair, in one canonical orientation,
-- enforced by the database rather than by convention. Concurrent accepts
-- therefore serialise on the unique index: one inserts, the rest take the
-- conflict branch. No new identity table, no UUID remapping.

-- ---------------------------------------------------------------------------
-- 1. A pending request is blocked only by an ACTIVE friendship.
-- ---------------------------------------------------------------------------

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
      -- An ENDED friendship must not block a fresh request: that is precisely
      -- how two people become Muddies again. Without this clause the soft
      -- ending introduced in this phase would silently become permanent.
      and friendship.ended_at is null
  ) then
    raise exception 'users_are_already_friends' using errcode = '23514';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Acceptance creates OR reactivates, and reports which.
-- ---------------------------------------------------------------------------
--
-- The signature gains a `reactivated` column. Callers select named columns, so
-- an added column is backward compatible; the return type must be dropped
-- first because Postgres cannot change it in place.

drop function if exists public.accept_friend_request(uuid);

create function public.accept_friend_request(p_request_id uuid)
returns table(sender_id uuid, receiver_id uuid, reactivated boolean)
language plpgsql
security definer
set search_path = public, pg_temp
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

  pair_one := least(request_row.sender_id, request_row.receiver_id);
  pair_two := greatest(request_row.sender_id, request_row.receiver_id);

  -- Lock the existing row (if any) BEFORE the upsert, so two concurrent
  -- acceptances cannot both observe "ended" and both report a reactivation.
  -- The loser blocks here, then re-reads the row as already active and
  -- reports reactivated = false — one relationship, one reactivation.
  select (friendship.ended_at is not null)
  into was_ended
  from public.friendships as friendship
  where friendship.user_one_id = pair_one
    and friendship.user_two_id = pair_two
  for update;

  if not found then
    was_ended := false;
  end if;

  insert into public.friendships (
    user_one_id,
    user_two_id,
    accepted_request_id,
    ended_at
  )
  values (
    pair_one,
    pair_two,
    request_row.id,
    null
  )
  on conflict (user_one_id, user_two_id)
  do update set
    accepted_request_id = excluded.accepted_request_id,
    -- Reactivation: the SAME row, the same id, the same created_at. Clearing
    -- ended_at restores access; it does not restart the relationship, which is
    -- what keeps the timeline continuous across the gap.
    ended_at = null;

  -- Settle every pending request for the pair, including legacy reciprocal or
  -- duplicate rows, in the same transaction as the friendship.
  update public.friend_requests as request
  set status = 'accepted', responded_at = now(), updated_at = now()
  where request.status = 'pending'
    and least(request.sender_id, request.receiver_id) = pair_one
    and greatest(request.sender_id, request.receiver_id) = pair_two;

  return query select request_row.sender_id, request_row.receiver_id, was_ended;
end;
$$;

revoke all on function public.accept_friend_request(uuid) from public;
grant execute on function public.accept_friend_request(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Reads of active friendships stay fast.
-- ---------------------------------------------------------------------------
-- `friendships_active_pair_idx` (batch 15) already covers (user_one_id,
-- user_two_id) where ended_at is null. Every active-friend read also filters
-- by ONE side of the pair via .or(), which that index cannot serve, so add the
-- two single-column partial indexes those queries actually need.

create index if not exists friendships_active_user_one_idx
  on public.friendships(user_one_id)
  where ended_at is null;

create index if not exists friendships_active_user_two_idx
  on public.friendships(user_two_id)
  where ended_at is null;

-- ---------------------------------------------------------------------------
-- NOT DONE HERE, DELIBERATELY: backfilling history for past hard deletions.
-- ---------------------------------------------------------------------------
-- Every friendship removed before this migration was DELETEd. Those rows are
-- gone: their created_at, their ended_at, and the fact the pair were ever
-- Muddies cannot be recovered from `friendships`.
--
-- They are NOT reconstructed, and must not be. The only surviving trace is a
-- `relationship.ended` event for removals that happened after Phase 3 shipped
-- emission, and an ending with no beginning is not a relationship history —
-- inferring a created_at from it would be fabricating a date the product never
-- recorded. `rebuildRelationship` reads whatever rows survive and replays only
-- those; pairs with no row simply have no timeline, which is the truthful
-- answer rather than an invented one.
