-- Chats V4 completion additions.
--
-- This migration is intentionally additive and remains unapplied until the
-- product-wide Supabase push. It may be reviewed/renumbered when the other
-- pending backend branch is reconciled.

-- Message Info needs a trustworthy timestamp for when a member advanced their
-- canonical last-read anchor. Existing code already updates
-- last_read_message_id; a DB trigger stamps the time so every writer (web,
-- native API, future workers) gets the same behaviour without duplicating it.
alter table public.conversation_members
  add column if not exists last_read_at timestamptz;

update public.conversation_members
set last_read_at = coalesce(last_read_at, updated_at)
where last_read_message_id is not null
  and last_read_at is null;

create or replace function public.stamp_conversation_member_last_read_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.last_read_message_id is distinct from old.last_read_message_id then
    new.last_read_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists conversation_members_last_read_stamp on public.conversation_members;
create trigger conversation_members_last_read_stamp
before update of last_read_message_id on public.conversation_members
for each row
execute function public.stamp_conversation_member_last_read_at();

create index if not exists conversation_members_read_anchor_idx
  on public.conversation_members(conversation_id, last_read_at desc)
  where status = 'joined' and last_read_message_id is not null;
