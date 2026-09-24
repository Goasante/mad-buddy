-- Trigger functions are invoked by their triggers; browser roles need no
-- standalone EXECUTE grant. Restrict only SECURITY DEFINER trigger functions
-- to avoid changing the browser RPC contract of ordinary functions.
do $$
declare
  fn record;
begin
  for fn in
    select n.nspname, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and p.prorettype = 'pg_catalog.trigger'::regtype
  loop
    execute format('revoke execute on function %I.%I() from public, anon, authenticated', fn.nspname, fn.proname);
  end loop;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and p.prorettype = 'pg_catalog.trigger'::regtype
      and (has_function_privilege('anon', p.oid, 'EXECUTE')
        or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  ) then
    raise exception 'Browser role retains EXECUTE on a SECURITY DEFINER trigger function';
  end if;
end $$;
