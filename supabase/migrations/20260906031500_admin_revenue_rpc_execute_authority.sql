-- Close the remaining hosted-default EXECUTE leak on two admin-only revenue RPCs.
--
-- Historical migration 20260726180000 correctly intended these SECURITY DEFINER
-- functions to be service-role only, but it revoked only FROM PUBLIC. Production
-- later carried explicit anon/authenticated EXECUTE grants inherited from the
-- hosted function default ACL, so the publishable key could read business-only
-- subscription and media-storage aggregates.
--
-- Migration 134 fixes the DEFAULT for future postgres-created functions. This
-- migration repairs the two already-existing objects. No business logic changes.

revoke all privileges on function public.get_revenue_subscription_snapshot(timestamptz)
  from public, anon, authenticated;
revoke all privileges on function public.get_admin_media_storage_summary()
  from public, anon, authenticated;

grant execute on function public.get_revenue_subscription_snapshot(timestamptz)
  to service_role;
grant execute on function public.get_admin_media_storage_summary()
  to service_role;

-- Fail the migration rather than report false success if browser execution is
-- still effective (including through PUBLIC) or if trusted server authority was
-- accidentally removed.
do $$
begin
  if has_function_privilege('anon',
       'public.get_revenue_subscription_snapshot(timestamptz)', 'EXECUTE')
     or has_function_privilege('authenticated',
       'public.get_revenue_subscription_snapshot(timestamptz)', 'EXECUTE') then
    raise exception 'revenue snapshot RPC remains browser-executable';
  end if;

  if has_function_privilege('anon',
       'public.get_admin_media_storage_summary()', 'EXECUTE')
     or has_function_privilege('authenticated',
       'public.get_admin_media_storage_summary()', 'EXECUTE') then
    raise exception 'media storage summary RPC remains browser-executable';
  end if;

  if not has_function_privilege('service_role',
       'public.get_revenue_subscription_snapshot(timestamptz)', 'EXECUTE') then
    raise exception 'service_role lost revenue snapshot RPC authority';
  end if;

  if not has_function_privilege('service_role',
       'public.get_admin_media_storage_summary()', 'EXECUTE') then
    raise exception 'service_role lost media storage summary RPC authority';
  end if;
end $$;
