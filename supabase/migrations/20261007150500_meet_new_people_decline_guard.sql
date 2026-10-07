-- A creator's decline is final for this listing. A user who withdrew
-- themselves may re-enter while the listing is still open.
create or replace function public.prevent_declined_discovery_reentry() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if old.status='declined' and new.status='pending' then
    raise exception 'DISCOVERY_DECLINED';
  end if;
  return new;
end $$;

drop trigger if exists meetup_discovery_declined_reentry_guard on public.meetup_discovery_interests;
create trigger meetup_discovery_declined_reentry_guard
before update of status on public.meetup_discovery_interests
for each row execute function public.prevent_declined_discovery_reentry();

revoke all on function public.prevent_declined_discovery_reentry() from public,anon,authenticated;
