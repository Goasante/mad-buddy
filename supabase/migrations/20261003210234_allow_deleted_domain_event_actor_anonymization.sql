-- Version aligned with the staging migration history after verification.
-- Auth deletion invokes ON DELETE SET NULL on domain_events.actor_id. The
-- blanket append-only guard rejected that FK action and rolled back deletion.
-- Permit ONLY nested FK anonymization once the referenced Auth row is gone.
-- Event payload, identity, ordering and all other fields remain immutable.
create or replace function public.prevent_domain_event_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' and pg_trigger_depth() > 1
     and old.actor_id is not null and new.actor_id is null
     and (to_jsonb(new) - 'actor_id') = (to_jsonb(old) - 'actor_id')
     and not exists(select 1 from auth.users u where u.id = old.actor_id) then
    return new;
  end if;
  raise exception 'Domain events are append-only and cannot be modified or deleted.';
end;
$$;
revoke all on function public.prevent_domain_event_mutation() from public, anon, authenticated;
