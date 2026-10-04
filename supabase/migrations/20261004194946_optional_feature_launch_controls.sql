begin;

-- Launch scope: discovery/Glow, Muddies, Messages and Plans are not gated.
insert into public.feature_flags (key, description, status, default_value)
values
 ('upfor', 'UpFor launch availability', 'off', false),
 ('socialize', 'Linkr launch availability', 'off', false),
 ('events', 'Events launch availability', 'off', false),
 ('conference', 'Conference launch availability', 'off', false),
 ('safe_arrival', 'New Safe Arrival journeys', 'off', false)
on conflict (key) do update set status = 'off', default_value = false, updated_at = now();

-- Invoker function: feature_flags already has authenticated read grants/RLS.
-- No privileged public RPC is introduced.
create or replace function public.optional_feature_available(p_key text)
returns boolean language sql stable security invoker set search_path = '' as $$
 select exists (
   select 1 from public.feature_flags
   where key = p_key and (status = 'on' or (status = 'rollout' and default_value))
 );
$$;
revoke all on function public.optional_feature_available(text) from public, anon;
grant execute on function public.optional_feature_available(text) to authenticated, service_role;

-- Restrictive policies add to, rather than replace, the current ownership rules.
-- Service-role cleanup and administration retain their existing authority.
do $$
declare item record;
begin
 for item in select * from (values
  ('hangout_sessions', 'upfor'), ('hangout_requests', 'upfor'), ('hangout_audience_targets', 'upfor'),
  ('events', 'events'), ('event_rsvps', 'events'), ('event_updates', 'events'),
  ('event_update_reactions', 'events'), ('event_linkr_opt_ins', 'events'),
  ('event_audience_targets', 'events'), ('event_locations', 'events'),
  ('linkr_profiles', 'socialize'), ('linkr_photos', 'socialize'),
  ('linkr_actions', 'socialize'), ('linkr_connections', 'socialize'), ('linkr_interests', 'socialize')
 ) as t(table_name, flag_key)
 loop
  if to_regclass(format('public.%I', item.table_name)) is null then continue; end if;
  execute format('create policy optional_feature_release_read on public.%I as restrictive for select to authenticated using ((select public.optional_feature_available(%L)))', item.table_name, item.flag_key);
  execute format('create policy optional_feature_release_insert on public.%I as restrictive for insert to authenticated with check ((select public.optional_feature_available(%L)))', item.table_name, item.flag_key);
  execute format('create policy optional_feature_release_update on public.%I as restrictive for update to authenticated using ((select public.optional_feature_available(%L))) with check ((select public.optional_feature_available(%L)))', item.table_name, item.flag_key, item.flag_key);
 end loop;
end $$;

-- Insert guards cover server RPCs too: UI/server checks cannot race the switch.
-- These never intercept deletes, expiry updates or active journey transitions.
create or replace function public.guard_optional_feature_insert()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
 if not public.optional_feature_available(TG_ARGV[0]) then
   raise exception 'optional_feature_locked' using errcode = '42501';
 end if;
 return new;
end;
$$;
revoke all on function public.guard_optional_feature_insert() from public, anon, authenticated;
grant execute on function public.guard_optional_feature_insert() to service_role;
create trigger optional_feature_release_insert before insert on public.hangout_sessions
 for each row execute function public.guard_optional_feature_insert('upfor');
create trigger optional_feature_release_insert before insert on public.hangout_requests
 for each row execute function public.guard_optional_feature_insert('upfor');
create trigger optional_feature_release_insert before insert on public.events
 for each row execute function public.guard_optional_feature_insert('events');
create trigger optional_feature_release_insert before insert on public.safe_arrival_sessions
 for each row execute function public.guard_optional_feature_insert('safe_arrival');

commit;
