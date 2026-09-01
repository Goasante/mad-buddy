-- Mad Buddy Access convergence: Air/Moments is free core.
--
-- This is additive and intentionally leaves the historical migration untouched.
-- It changes only the current RLS helper used by the existing public-Moment
-- insert/update policies. Blocks, moderation, expiry, authenticated-only reads,
-- the open_moments feature flag, and all existing privacy policies remain intact.

update public.feature_flags
set description = 'Allows authenticated Mad Buddy members to view and publish Air when the feature is enabled.'
where key = 'open_moments';

create or replace function public.can_publish_open_moments(subject_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select subject_user_id is not null
    and exists (
      select 1
      from public.feature_flags f
      where f.key = 'open_moments'
        and f.status = 'on'
    );
$$;

revoke all on function public.can_publish_open_moments(uuid) from public;
grant execute on function public.can_publish_open_moments(uuid) to authenticated;
