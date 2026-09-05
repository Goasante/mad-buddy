-- ---------------------------------------------------------------------------
-- SEC-001. transition_safe_arrival: EXECUTE authority for the whole function
-- family.
--
-- transition_safe_arrival is SECURITY DEFINER and authorizes on `p_actor_id`,
-- a caller-supplied parameter, rather than auth.uid(). That is correct for a
-- function only ever invoked with trusted server authority -- and it is exactly
-- why no browser role may execute it. The single caller,
-- lib/safety/safe-arrival-authority.ts, uses the admin (service_role) client.
--
-- WHAT WENT WRONG
--
-- 20260830223000 revoked it properly:
--
--   revoke all on function public.transition_safe_arrival(uuid,uuid,text,integer)
--     from public, anon, authenticated;
--
-- 20260904200000 then added a fifth argument, p_client_mutation_id, for D5
-- idempotency. In PostgreSQL a function's SIGNATURE IS ITS IDENTITY: that
-- `create or replace` did not replace the 4-argument function, it created a
-- second, distinct object. The earlier revoke did not reach it, and every newly
-- created function is born with EXECUTE granted TO PUBLIC. The migration
-- granted service_role and stopped -- its comment reads "REVOKE strips
-- service_role too, so the server's own grant is restated", so the compensation
-- was written while the REVOKE it compensated for was not.
--
-- Observed, over HTTP, with only the publishable anon key and no session:
--
--   POST /rest/v1/rpc/transition_safe_arrival
--   {"p_session_id": <victim>, "p_actor_id": <victim traveller>,
--    "p_action": "cancel", ...}
--   -> [{"canonical_status":"cancelled","changed":true}]
--
-- Cancelling a session stops watcher escalation, so a person who never arrives
-- is never escalated for.
--
-- WHY THIS MIGRATION IS WRITTEN AGAINST THE CATALOG
--
-- Naming the two signatures literally would fix today's defect and leave the
-- mechanism intact: the next overload would again be born PUBLIC-executable and
-- again be missed. So this enumerates every function actually named
-- public.transition_safe_arrival and normalizes each one. It is correct for the
-- two that exist now and for any that exist when it runs.
--
-- Business logic is untouched. Privilege isolation is sufficient: the exploit
-- needs EXECUTE, and after this no browser role has it.
-- ---------------------------------------------------------------------------

do $$
declare
  r record;
  v_count integer := 0;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'transition_safe_arrival'
      and p.prokind = 'f'
    order by 1
  loop
    -- REVOKE ALL FROM PUBLIC also strips the share service_role holds through
    -- PUBLIC, so the server's authority is re-granted immediately below. A
    -- lockdown that also locks out the server has taken this app down before.
    execute format('revoke all on function %s from public', r.sig);
    execute format('revoke all on function %s from anon', r.sig);
    execute format('revoke all on function %s from authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);

    v_count := v_count + 1;
    raise notice 'SEC-001: normalized EXECUTE authority on %', r.sig;
  end loop;

  if v_count = 0 then
    raise exception
      'SEC-001: no public.transition_safe_arrival function found -- refusing to report success';
  end if;

  raise notice 'SEC-001: % overload(s) normalized', v_count;
end $$;

-- ---------------------------------------------------------------------------
-- Assert the result rather than trusting the loop. If any overload can still be
-- executed by a browser role, or the server has lost its own authority, this
-- migration must fail rather than leave production believing it is fixed.
--
-- has_function_privilege() is used deliberately: it answers the EFFECTIVE
-- question, including privileges held indirectly, which is the question the
-- exploit actually asked.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  v_bad text[] := '{}';
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'transition_safe_arrival'
      and p.prokind = 'f'
  loop
    if has_function_privilege('public', r.sig, 'EXECUTE') then
      v_bad := v_bad || format('PUBLIC can execute %s', r.sig);
    end if;
    if has_function_privilege('anon', r.sig, 'EXECUTE') then
      v_bad := v_bad || format('anon can execute %s', r.sig);
    end if;
    if has_function_privilege('authenticated', r.sig, 'EXECUTE') then
      v_bad := v_bad || format('authenticated can execute %s', r.sig);
    end if;
    if not has_function_privilege('service_role', r.sig, 'EXECUTE') then
      v_bad := v_bad || format('service_role LOST execute on %s', r.sig);
    end if;
  end loop;

  if array_length(v_bad, 1) is not null then
    raise exception 'SEC-001 verification failed: %', array_to_string(v_bad, '; ');
  end if;

  raise notice 'SEC-001: verified -- no browser role can execute any overload; service_role intact';
end $$;

comment on function public.transition_safe_arrival(uuid, uuid, text, integer, uuid) is
  'Server-only. Authorizes on p_actor_id, not auth.uid(), so it must never be executable by anon or authenticated. EXECUTE is normalized across the whole overload family by 20260905120000 (SEC-001); any NEW overload must be revoked the same way -- a signature is a distinct object and does not inherit the revoke.';
