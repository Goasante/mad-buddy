-- Removing a Muddy must end their RLS access, not just hide them in the UI.
--
-- Removal is a SOFT ending: the friendships row is retained with ended_at set,
-- so the relationship can resume without losing its history. Every application
-- query already treats `ended_at is null` as the definition of "currently
-- Muddies" -- but is_friend(), which backs the profiles SELECT policy, did not.
--
-- The effect was that someone you removed still satisfied `is_friend(user_id)`
-- and could read your profile row directly through PostgREST with their own
-- JWT: full_name, username, bio, mood_status, general_area, institution.
-- The product UI was unaffected (it reads through the admin client and filters
-- ended_at itself), so this was the defence-in-depth layer failing silently --
-- which is the layer that matters when the others are bypassed.
--
-- is_blocked_between() is already bidirectional and correct; only this one
-- function missed the check.
--
-- NOT a data migration: no rows change. Existing ended friendships simply stop
-- granting access the moment this runs.
--
-- Rollback:
--   create or replace function public.is_friend(target_user_id uuid)
--   returns boolean language sql security definer stable set search_path = public as $$
--     select exists (
--       select 1 from public.friendships
--       where (user_one_id = auth.uid() and user_two_id = target_user_id)
--          or (user_two_id = auth.uid() and user_one_id = target_user_id)
--     );
--   $$;

create or replace function public.is_friend(target_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.friendships
    where
      -- The whole point of this migration. A removed friendship is not a
      -- friendship, at every layer, not only in the queries that remembered.
      ended_at is null
      and (
        (user_one_id = auth.uid() and user_two_id = target_user_id)
        or
        (user_two_id = auth.uid() and user_one_id = target_user_id)
      )
  );
$$;

comment on function public.is_friend(uuid) is
  'True when the caller and target are CURRENTLY Muddies. Excludes soft-ended friendships (ended_at is not null): removal must revoke RLS access immediately, matching every application-level query.';
