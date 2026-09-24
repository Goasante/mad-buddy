-- These privileged functions bypass table RLS. Only server jobs and
-- server-rendered projections call them; neither browser role needs EXECUTE.
-- Revoke explicit grants as well as PUBLIC. Older production defaults granted
-- anon/authenticated directly, so revoking PUBLIC alone is insufficient.
revoke all on function public.birthday_users_for_day(integer, integer, boolean)
  from public, anon, authenticated;
grant execute on function public.birthday_users_for_day(integer, integer, boolean)
  to service_role;

revoke all on function public.moment_engagement(uuid[])
  from public, anon, authenticated;
grant execute on function public.moment_engagement(uuid[])
  to service_role;

revoke all on function public.tune_in_counts(uuid[])
  from public, anon, authenticated;
grant execute on function public.tune_in_counts(uuid[])
  to service_role;

do $$
declare
  signature regprocedure;
begin
  foreach signature in array array[
    'public.birthday_users_for_day(integer,integer,boolean)'::regprocedure,
    'public.moment_engagement(uuid[])'::regprocedure,
    'public.tune_in_counts(uuid[])'::regprocedure
  ] loop
    if has_function_privilege('anon', signature, 'EXECUTE')
       or has_function_privilege('authenticated', signature, 'EXECUTE')
       or not has_function_privilege('service_role', signature, 'EXECUTE') then
      raise exception 'Private RPC privileges are unsafe: %', signature;
    end if;
  end loop;
end $$;
