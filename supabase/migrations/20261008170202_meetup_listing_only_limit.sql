-- Only open discovery listings consume the three listing slots.
-- Arranged Meetups (including upcoming Plans and matched discoveries) do not.
create or replace function public.meetup_owner_active_slot_count(p_actor_id uuid) returns integer
language sql stable security invoker set search_path='' as $$
  select count(*)::integer
  from public.meetup_discoveries d
  where d.creator_id=p_actor_id
    and d.status='active'
    and d.listing_expires_at>now()
    and d.starts_at>now();
$$;

-- Enforce the limit on listings, including refreshes, rather than Meetup inserts.
create or replace function public.enforce_meetup_owner_slot_limit() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if new.status='active' and new.listing_expires_at>now() and new.starts_at>now() then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.creator_id::text,0));
    if (select count(*) from public.meetup_discoveries d
        where d.creator_id=new.creator_id and d.id<>new.id
          and d.status='active' and d.listing_expires_at>now() and d.starts_at>now())>=3 then
      raise exception 'MEETUP_LIMIT';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists meetups_owner_slot_limit on public.meetups;
drop trigger if exists meetup_discoveries_owner_slot_limit on public.meetup_discoveries;
create trigger meetup_discoveries_owner_slot_limit
before insert or update of status,listing_expires_at,starts_at,creator_id on public.meetup_discoveries
for each row execute function public.enforce_meetup_owner_slot_limit();

revoke all on function public.meetup_owner_active_slot_count(uuid),
  public.enforce_meetup_owner_slot_limit() from public,anon,authenticated;
grant execute on function public.meetup_owner_active_slot_count(uuid) to service_role;
