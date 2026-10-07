-- Close stale response rows automatically when a discovery fills.
create or replace function public.close_filled_meetup_discovery_responses() returns trigger
language plpgsql security invoker set search_path='' as $$
declare
  v_style text;
  v_max integer;
  v_accepted integer;
begin
  if new.status<>'accepted' or old.status='accepted' then return new; end if;

  select meetup_style,max_attendees into v_style,v_max
  from public.meetup_discoveries where id=new.discovery_id for update;

  select count(*) into v_accepted
  from public.meetup_discovery_interests
  where discovery_id=new.discovery_id and status='accepted';

  if v_style='one_to_one' or v_accepted>=v_max-1 then
    update public.meetup_discovery_interests
      set status='declined',updated_at=now()
      where discovery_id=new.discovery_id
        and user_id<>new.user_id
        and status='pending';

    update public.meetup_discoveries
      set status='matched',updated_at=now()
      where id=new.discovery_id;
  end if;

  return new;
end $$;

drop trigger if exists meetup_discovery_close_filled_responses on public.meetup_discovery_interests;
create trigger meetup_discovery_close_filled_responses
after update of status on public.meetup_discovery_interests
for each row execute function public.close_filled_meetup_discovery_responses();

revoke all on function public.close_filled_meetup_discovery_responses() from public,anon,authenticated;
