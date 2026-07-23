-- Surface the cron job's own error text. Without this a failing tick is just
-- status='failed' with no reason, which is exactly the kind of silent failure
-- that hid the previous scheduler outage for 19 hours.

create or replace function private.cron_tick_runs(p_limit int default 5)
returns table (
  started_at timestamptz,
  status text,
  return_message text
)
language sql
security definer
set search_path = ''
as $$
  select d.start_time, d.status, d.return_message
  from cron.job_run_details d
  join cron.job j on j.jobid = d.jobid
  where j.jobname = 'cron-tick-5min'
  order by d.start_time desc
  limit p_limit
$$;

create or replace function public.admin_cron_tick_runs(p_limit int default 5)
returns table (
  started_at timestamptz,
  status text,
  return_message text
)
language sql
security definer
set search_path = ''
as $$ select * from private.cron_tick_runs(p_limit) $$;

revoke all on function private.cron_tick_runs(int) from public, anon, authenticated;
revoke all on function public.admin_cron_tick_runs(int) from public, anon, authenticated;
grant execute on function private.cron_tick_runs(int) to service_role;
grant execute on function public.admin_cron_tick_runs(int) to service_role;
