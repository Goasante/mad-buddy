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
-- IMPORTANT: this MUST keep the dynamic pg_net schema resolution introduced by
-- 20260723200000_cron_tick_net_schema.sql. Supabase has moved pg_net between
-- schemas across platform versions, and hardcoding `extensions.http_get` here
-- broke every tick with "function extensions.http_get does not exist". The
-- lookup below resolves the real schema from the catalog at call time.
--
-- Credentials are untouched: the URL and bearer secret still live in Vault and
-- are still read at call time. Nothing secret appears in this file.
--
-- Rollback: re-run the definition from
-- supabase/migrations/20260723200000_cron_tick_net_schema.sql. The schedule
-- entry and the Vault secrets are unaffected either way.

create or replace function private.run_cron_tick()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
  v_schema text;
  v_target text;
  v_request_id bigint;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'cron_tick_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_tick_secret';

  -- Not yet configured: do nothing rather than fire an unauthenticated call.
  if v_url is null or v_secret is null then
    return null;
  end if;

  -- Wherever pg_net currently lives.
  select n.nspname
    into v_schema
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where p.proname = 'http_get'
     and n.nspname in ('net', 'extensions', 'public')
   order by case n.nspname when 'net' then 1 when 'extensions' then 2 else 3 end
   limit 1;

  if v_schema is null then
    raise exception 'pg_net http_get() not found in net, extensions, or public.';
  end if;

  -- Append the source without assuming the stored URL has no query string of
  -- its own, so a future URL change cannot silently produce a malformed one.
  v_target := v_url || case when position('?' in v_url) > 0 then '&' else '?' end
                    || 'source=supabase_cron';

  -- pg_net is asynchronous: this queues the request and returns immediately,
  -- so a slow endpoint can never stall the cron slot.
  execute format(
    'select %I.http_get(url := $1, headers := $2, timeout_milliseconds := $3)',
    v_schema
  )
  into v_request_id
  using v_target,
        jsonb_build_object('Authorization', 'Bearer ' || v_secret),
        55000;

  return v_request_id;
end;
$$;

revoke all on function private.run_cron_tick() from public, anon, authenticated;
grant execute on function private.run_cron_tick() to service_role;
