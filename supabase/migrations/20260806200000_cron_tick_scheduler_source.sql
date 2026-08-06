-- Tag the pg_cron tick with its scheduler source.
--
-- Why: two schedulers call /api/cron/tick — pg_cron (primary, real 5-minute
-- cadence) and GitHub Actions (a 30-minute recovery backstop). Without a
-- source on each call, a silently-dead primary looks identical to a healthy
-- one for as long as the backstop keeps covering. Tagging makes a delayed or
-- missing primary tick attributable.
--
-- Observability only. The endpoint runs identical work whatever the source
-- says, and an unrecognised value is recorded as "unknown" rather than
-- rejected — refusing to process due jobs over a bad label would turn a
-- cosmetic problem into a missed safety alert.
--
-- Credentials are untouched: the URL and bearer secret still live in Vault and
-- are still read at call time. Nothing secret appears in this file.
--
-- Rollback: re-run the previous definition of private.run_cron_tick() from
-- supabase/migrations/20260723180000_pg_cron_tick.sql. The schedule entry and
-- the Vault secrets are unaffected either way.

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
  v_target text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'cron_tick_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_tick_secret';

  -- Not yet configured: do nothing rather than fire an unauthenticated call.
  if v_url is null or v_secret is null then
    return null;
  end if;

  -- Append the source without assuming the stored URL has no query string of
  -- its own, so a future URL change cannot silently produce a malformed one.
  v_target := v_url || case when position('?' in v_url) > 0 then '&' else '?' end
                    || 'source=supabase_cron';

  -- pg_net is asynchronous: http_get queues the request and returns an id
  -- immediately, so a slow endpoint can never block or lengthen the cron slot.
  select extensions.http_get(
    url := v_target,
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret),
    timeout_milliseconds := 55000
  ) into v_request_id;

  return v_request_id;
end;
$$;

-- Unchanged from the original definition; restated so a fresh database gets
-- the same grants as an upgraded one.
revoke all on function private.run_cron_tick() from public, anon, authenticated;
grant execute on function private.run_cron_tick() to service_role;
