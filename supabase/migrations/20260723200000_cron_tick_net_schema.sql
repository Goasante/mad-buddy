-- Fix: the tick called extensions.http_get, which does not exist here.
--
-- pg_net was already installed in the `net` schema, so the earlier
-- `create extension if not exists pg_net with schema extensions` was a silent
-- no-op and every run failed with "function extensions.http_get does not
-- exist". Supabase has moved pg_net between schemas across platform versions,
-- so rather than hardcode `net` and risk the same breakage later, resolve the
-- function's real schema from the catalog at call time.

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

  -- pg_net is asynchronous: this queues the request and returns immediately,
  -- so a slow endpoint can never stall the cron slot.
  execute format(
    'select %I.http_get(url := $1, headers := $2, timeout_milliseconds := $3)',
    v_schema
  )
  into v_request_id
  using v_url,
        jsonb_build_object('Authorization', 'Bearer ' || v_secret),
        55000;

  return v_request_id;
end;
$$;

revoke all on function private.run_cron_tick() from public, anon, authenticated;
grant execute on function private.run_cron_tick() to service_role;
