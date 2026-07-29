-- N+1/aggregation fix: the Admin overview page previously fetched up to
-- 10,000 raw profiles.created_at rows and up to 10,000 raw
-- subscriptions.plan rows to the app server just to bucket/count them in
-- JavaScript. Both are trivial Postgres aggregates. Additive only.

create or replace function public.admin_daily_signup_counts(p_since timestamptz)
returns table (day date, count bigint)
language sql
stable
as $$
  select date_trunc('day', created_at)::date as day, count(*)::bigint as count
  from public.profiles
  where deleted_at is null and created_at >= p_since
  group by 1
  order by 1;
$$;

create or replace function public.admin_active_plan_mix()
returns table (plan text, count bigint)
language sql
stable
as $$
  select plan::text as plan, count(*)::bigint as count
  from public.subscriptions
  where status in ('active', 'trialing') and plan != 'free'
  group by 1;
$$;

revoke all on function public.admin_daily_signup_counts(timestamptz) from public, anon, authenticated;
revoke all on function public.admin_active_plan_mix() from public, anon, authenticated;
grant execute on function public.admin_daily_signup_counts(timestamptz) to service_role;
grant execute on function public.admin_active_plan_mix() to service_role;
