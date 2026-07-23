-- In-database scheduler for /api/cron/tick.
--
-- Why: the GitHub Actions workflow is declared as "*/5 * * * *" but GitHub
-- throttles scheduled workflows heavily — the real observed cadence was
-- roughly hourly. safe_arrival.unconfirmed_alert is a SAFETY job that is
-- supposed to run every 5 minutes, so an hourly best-effort scheduler is not
-- good enough. pg_cron runs inside Postgres on a real 5-minute schedule.
--
-- The Actions workflow stays as a redundant backup. The endpoint buckets by
-- job type and is idempotent, so two schedulers calling it is harmless.
--
-- Credentials are NEVER stored in this file. The endpoint URL and bearer
-- secret live in Supabase Vault (encrypted at rest) and are written once by
-- calling private.configure_cron_tick(), which is executable only by the
-- service role.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

create schema if not exists private;
revoke all on schema private from anon, authenticated;

/**
 * Stores (or replaces) the cron tick endpoint URL and bearer secret in Vault.
 * Kept as a function so the secret is passed at call time and never appears
 * in a committed migration or in git history.
 */
create or replace function private.configure_cron_tick(p_url text, p_secret text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if coalesce(p_url, '') = '' or coalesce(p_secret, '') = '' then
    raise exception 'Both the URL and the secret are required.';
  end if;

  select id into v_id from vault.secrets where name = 'cron_tick_url';
  if v_id is null then
    perform vault.create_secret(p_url, 'cron_tick_url', 'Cron tick endpoint URL');
  else
    perform vault.update_secret(v_id, p_url, 'cron_tick_url', 'Cron tick endpoint URL');
  end if;

  select id into v_id from vault.secrets where name = 'cron_tick_secret';
  if v_id is null then
    perform vault.create_secret(p_secret, 'cron_tick_secret', 'Bearer secret for the cron tick endpoint');
  else
    perform vault.update_secret(v_id, p_secret, 'cron_tick_secret', 'Bearer secret for the cron tick endpoint');
  end if;
end;
$$;

/**
 * Fires one tick. Reads its credentials from Vault at call time, so rotating
 * the secret is a single configure_cron_tick() call with no redeploy here.
 *
 * pg_net is asynchronous: http_get queues the request and returns an id
 * immediately, so a slow endpoint can never block or lengthen the cron slot.
 */
create or replace function private.run_cron_tick()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
  v_request_id bigint;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'cron_tick_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_tick_secret';

  -- Not yet configured: do nothing rather than fire an unauthenticated call.
  if v_url is null or v_secret is null then
    return null;
  end if;

  select extensions.http_get(
    url := v_url,
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret),
    timeout_milliseconds := 55000
  ) into v_request_id;

  return v_request_id;
end;
$$;

/**
 * Read-only health view of the schedule, so the tick can be verified without
 * granting anything broader over the cron catalog.
 */
create or replace function private.cron_tick_status()
returns table (
  configured boolean,
  job_scheduled boolean,
  last_run_started_at timestamptz,
  last_run_status text,
  last_response_status_code integer
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  select
    exists (select 1 from vault.secrets where name = 'cron_tick_secret'),
    exists (select 1 from cron.job where jobname = 'cron-tick-5min'),
    (select start_time from cron.job_run_details d
       join cron.job j on j.jobid = d.jobid
      where j.jobname = 'cron-tick-5min'
      order by d.start_time desc limit 1),
    (select d.status from cron.job_run_details d
       join cron.job j on j.jobid = d.jobid
      where j.jobname = 'cron-tick-5min'
      order by d.start_time desc limit 1),
    (select r.status_code from net._http_response r order by r.created desc limit 1);
end;
$$;

-- Service role only. These read Vault and reach the network, so anon and
-- authenticated must never be able to call them.
revoke all on function private.configure_cron_tick(text, text) from public, anon, authenticated;
revoke all on function private.run_cron_tick() from public, anon, authenticated;
revoke all on function private.cron_tick_status() from public, anon, authenticated;
grant execute on function private.configure_cron_tick(text, text) to service_role;
grant execute on function private.run_cron_tick() to service_role;
grant execute on function private.cron_tick_status() to service_role;
grant usage on schema private to service_role;

-- PostgREST only exposes the `public` schema, so configuration and health
-- checks need a thin wrapper there. Execution stays service-role only, which
-- is what actually gates access — being visible to PostgREST is not access.
create or replace function public.admin_configure_cron_tick(p_url text, p_secret text)
returns void
language sql
security definer
set search_path = ''
as $$ select private.configure_cron_tick(p_url, p_secret) $$;

create or replace function public.admin_cron_tick_status()
returns table (
  configured boolean,
  job_scheduled boolean,
  last_run_started_at timestamptz,
  last_run_status text,
  last_response_status_code integer
)
language sql
security definer
set search_path = ''
as $$ select * from private.cron_tick_status() $$;

revoke all on function public.admin_configure_cron_tick(text, text) from public, anon, authenticated;
revoke all on function public.admin_cron_tick_status() from public, anon, authenticated;
grant execute on function public.admin_configure_cron_tick(text, text) to service_role;
grant execute on function public.admin_cron_tick_status() to service_role;

-- Replace any previous definition so re-running is safe.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'cron-tick-5min') then
    perform cron.unschedule('cron-tick-5min');
  end if;
  perform cron.schedule('cron-tick-5min', '*/5 * * * *', 'select private.run_cron_tick()');
end
$$;
