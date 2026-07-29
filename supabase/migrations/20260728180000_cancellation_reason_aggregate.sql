-- Aggregation fix: loadCancellationReasons() in lib/revenue/service.ts had
-- no upper bound at all — it fetched every subscription_changes cancel row
-- since the report's start date just to count reasons in JavaScript. This is
-- a plain SQL group-by. Additive only.

create or replace function public.get_cancellation_reason_counts(p_since timestamptz)
returns table (reason text, count bigint)
language sql
stable
as $$
  select trim(reason) as reason, count(*)::bigint as count
  from public.subscription_changes
  where change_type = 'cancel'
    and requested_at >= p_since
    and reason is not null
    and trim(reason) != ''
  group by 1
  order by count(*) desc, trim(reason) asc;
$$;

revoke all on function public.get_cancellation_reason_counts(timestamptz) from public, anon, authenticated;
grant execute on function public.get_cancellation_reason_counts(timestamptz) to service_role;
