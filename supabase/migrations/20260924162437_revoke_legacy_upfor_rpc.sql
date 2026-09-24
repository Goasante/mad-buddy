-- Phase 2: apply only after the web deployment calls the server-only RPC.
-- The original two overloads accept a caller-controlled concurrency limit.
revoke all on function public.create_upfor_session(
  text, text, text, text, text, timestamptz, timestamptz,
  text, integer, boolean, boolean, text, timestamptz, integer
) from public, anon, authenticated;
revoke all on function public.create_upfor_session(
  text, text, text, text, text, timestamptz, timestamptz,
  text, integer, boolean, boolean, text, timestamptz, integer, interval
) from public, anon, authenticated;

-- There is no browser table-write grant in production today. State it
-- explicitly in the migration so a future broad GRANT cannot revive the
-- direct-insert path by accident.
revoke insert, update, delete on table public.hangout_sessions
  from public, anon, authenticated;

do $$
begin
  if has_function_privilege('anon',
    'public.create_upfor_session(text,text,text,text,text,timestamptz,timestamptz,text,integer,boolean,boolean,text,timestamptz,integer)'::regprocedure, 'EXECUTE')
    or has_function_privilege('authenticated',
    'public.create_upfor_session(text,text,text,text,text,timestamptz,timestamptz,text,integer,boolean,boolean,text,timestamptz,integer)'::regprocedure, 'EXECUTE')
    or has_function_privilege('anon',
    'public.create_upfor_session(text,text,text,text,text,timestamptz,timestamptz,text,integer,boolean,boolean,text,timestamptz,integer,interval)'::regprocedure, 'EXECUTE')
    or has_function_privilege('authenticated',
    'public.create_upfor_session(text,text,text,text,text,timestamptz,timestamptz,text,integer,boolean,boolean,text,timestamptz,integer,interval)'::regprocedure, 'EXECUTE')
    or has_table_privilege('authenticated', 'public.hangout_sessions', 'INSERT') then
    raise exception 'Legacy UpFor browser write privilege remains';
  end if;
end $$;
