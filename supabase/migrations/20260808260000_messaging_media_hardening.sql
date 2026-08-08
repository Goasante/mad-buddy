-- Messaging media Phase 2: authority, parent binding, and orphan cleanup.
-- Additive hardening only. Existing media remains private and existing server
-- uploads continue through the service role.

alter table public.media_assets
  add column if not exists intended_conversation_id uuid
    references public.conversations(id) on delete set null,
  add column if not exists upload_expires_at timestamptz;

create index if not exists media_assets_chat_intent_idx
  on public.media_assets(intended_conversation_id, processing_status, created_at)
  where context_type = 'chat' and deleted_at is null;

-- Backfill the conversation intent only where historical use is unambiguous.
with bindings as (
  -- PostgreSQL does not define min(uuid); aggregate its canonical text form
  -- only after proving every historical binding points at one conversation.
  select media_id, min(conversation_id::text)::uuid as conversation_id
  from public.messages
  where media_id is not null
  group by media_id
  having count(distinct conversation_id) = 1
)
update public.media_assets asset
set intended_conversation_id = bindings.conversation_id
from bindings
where asset.id = bindings.media_id
  and asset.context_type = 'chat'
  and asset.intended_conversation_id is null;

-- Clients may inspect their own media metadata, but lifecycle authority is
-- server-only. In particular they cannot manufacture ready assets, variants,
-- moderation state, paths, or deletion state.
drop policy if exists "media assets owner access" on public.media_assets;
drop policy if exists "media assets owner read" on public.media_assets;
create policy "media assets owner read" on public.media_assets
  for select to authenticated
  using (auth.uid() = owner_id);

-- All current writers use the service-role-backed media actions. Remove the
-- generic owner storage policies so a modified client cannot bypass magic-byte
-- checks or create untracked objects under its folder.
drop policy if exists "media bucket owner writes" on storage.objects;
drop policy if exists "media bucket owner reads" on storage.objects;
drop policy if exists "media bucket owner deletes" on storage.objects;

-- Message creation and authoritative message state transitions are already
-- performed by the canonical server service. Removing direct client mutation
-- prevents bypassing rate limits, posting controls, and attachment validation.
drop policy if exists "messages insert by member sender" on public.messages;
drop policy if exists "messages update own" on public.messages;

alter table public.media_deletion_queue
  drop constraint if exists media_deletion_queue_reason_check;
alter table public.media_deletion_queue
  add constraint media_deletion_queue_reason_check check (
    reason in ('parent_deleted', 'parent_expired', 'user_deleted', 'moderation', 'orphaned_upload')
  );

-- A final database guard applies even to service-role writes. Application
-- validation gives friendly errors; this trigger is the non-bypassable floor.
create or replace function public.validate_message_media_attachment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  asset public.media_assets%rowtype;
  conversation_row public.conversations%rowtype;
  member_row public.conversation_members%rowtype;
  posting_mode text;
begin
  if new.media_id is null then
    return new;
  end if;

  if new.sender_id is null then
    raise exception 'message attachment requires a sender' using errcode = '23514';
  end if;

  select * into asset
  from public.media_assets
  where id = new.media_id
  for share;

  if not found
     or asset.owner_id <> new.sender_id
     or asset.context_type <> 'chat'
     or asset.intended_conversation_id is distinct from new.conversation_id
     or asset.processing_status <> 'ready'
     or asset.moderation_status <> 'active'
     or asset.deleted_at is not null
     or exists (
       select 1 from public.media_deletion_queue queue
       where queue.media_asset_id = asset.id and queue.processed_at is null
     ) then
    raise exception 'message attachment is not eligible' using errcode = '23514';
  end if;

  if new.message_type = 'image' and asset.content_type not like 'image/%' then
    raise exception 'message attachment type mismatch' using errcode = '23514';
  end if;
  if new.message_type = 'voice_note' and asset.content_type not like 'audio/%' then
    raise exception 'message attachment type mismatch' using errcode = '23514';
  end if;

  select * into conversation_row
  from public.conversations
  where id = new.conversation_id;
  if not found or conversation_row.status <> 'active' then
    raise exception 'conversation is not writable' using errcode = '42501';
  end if;

  select * into member_row
  from public.conversation_members
  where conversation_id = new.conversation_id
    and user_id = new.sender_id;
  if not found or member_row.status <> 'joined' then
    raise exception 'sender is not an active member' using errcode = '42501';
  end if;

  select coalesce(settings.posting_mode, 'all_members') into posting_mode
  from (select 1) seed
  left join public.group_settings settings
    on settings.conversation_id = new.conversation_id;
  if posting_mode = 'admins_only' and member_row.role not in ('owner', 'admin') then
    raise exception 'sender cannot post in this conversation' using errcode = '42501';
  end if;

  if conversation_row.conversation_type = 'direct' and exists (
    select 1
    from public.conversation_members other_member
    join public.blocked_users block
      on (block.blocker_id = new.sender_id and block.blocked_id = other_member.user_id)
      or (block.blocker_id = other_member.user_id and block.blocked_id = new.sender_id)
    where other_member.conversation_id = new.conversation_id
      and other_member.user_id <> new.sender_id
  ) then
    raise exception 'sender cannot post in this conversation' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_message_media_attachment_trigger on public.messages;
create trigger validate_message_media_attachment_trigger
  before insert or update of media_id, conversation_id, sender_id, message_type
  on public.messages
  for each row
  when (new.media_id is not null)
  execute function public.validate_message_media_attachment();

revoke all on function public.validate_message_media_attachment() from public, anon, authenticated;

-- Atomically queues stale, unattached chat assets. The message trigger refuses
-- assets once queued, so cleanup and send have one deterministic winner.
create or replace function public.queue_stale_unattached_chat_media(
  p_ready_before timestamptz,
  p_incomplete_before timestamptz,
  p_limit integer default 100
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  queued_count integer;
begin
  with candidates as (
    select asset.id
    from public.media_assets asset
    where asset.context_type = 'chat'
      and asset.deleted_at is null
      and (
        (asset.processing_status = 'ready' and asset.created_at < p_ready_before)
        or (
          asset.processing_status in ('pending', 'processing', 'failed')
          and coalesce(asset.upload_expires_at, asset.created_at) < p_incomplete_before
        )
      )
      and not exists (
        select 1 from public.messages message where message.media_id = asset.id
      )
      and not exists (
        select 1 from public.media_deletion_queue queue
        where queue.media_asset_id = asset.id and queue.processed_at is null
      )
    order by asset.created_at
    for update skip locked
    limit greatest(1, least(p_limit, 500))
  ), inserted as (
    insert into public.media_deletion_queue (media_asset_id, reason)
    select id, 'orphaned_upload' from candidates
    on conflict (media_asset_id) do nothing
    returning 1
  )
  select count(*) into queued_count from inserted;

  return queued_count;
end;
$$;

revoke all on function public.queue_stale_unattached_chat_media(timestamptz, timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.queue_stale_unattached_chat_media(timestamptz, timestamptz, integer)
  to service_role;
