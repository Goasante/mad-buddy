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

-- ---------------------------------------------------------------------------
-- Rich private chat media: video + documents.
-- ---------------------------------------------------------------------------

alter table public.media_assets
  add column if not exists original_file_name text;

alter table public.media_assets
  drop constraint if exists media_assets_original_file_name_check;
alter table public.media_assets
  add constraint media_assets_original_file_name_check check (
    original_file_name is null
    or (char_length(original_file_name) between 1 and 180 and original_file_name !~ '[\x00-\x1F\x7F]')
  );

alter table public.media_assets
  drop constraint if exists media_assets_intended_media_kind_check;
alter table public.media_assets
  add constraint media_assets_intended_media_kind_check check (
    intended_media_kind is null
    or intended_media_kind in ('image', 'voice_note', 'video', 'file')
  );

-- Extend the existing non-bypassable database media guard. Application code
-- gives friendly errors, but even service-role writes must not attach a PDF as
-- a video, an audio file as a document, or an asset bound to another chat.
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

  if new.message_type = 'image' and (
    asset.intended_media_kind <> 'image' or asset.content_type not like 'image/%'
  ) then
    raise exception 'message attachment type mismatch' using errcode = '23514';
  end if;
  if new.message_type = 'voice_note' and (
    asset.intended_media_kind <> 'voice_note' or asset.content_type not like 'audio/%'
  ) then
    raise exception 'message attachment type mismatch' using errcode = '23514';
  end if;
  if new.message_type = 'video' and (
    asset.intended_media_kind <> 'video'
    or asset.content_type not in ('video/mp4', 'video/webm', 'video/quicktime')
  ) then
    raise exception 'message attachment type mismatch' using errcode = '23514';
  end if;
  if new.message_type = 'file' and (
    asset.intended_media_kind <> 'file'
    or asset.content_type not in (
      'application/pdf', 'text/plain', 'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    )
  ) then
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

revoke all on function public.validate_message_media_attachment() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Canonical retention defaults + Keep in Chat.
-- ---------------------------------------------------------------------------
-- Conversation lifetime and the media default must be applied at the database
-- boundary, not only by the web composer. That keeps web, Capacitor/native API,
-- retries and future workers consistent. The dormant `view_once` foundation
-- value is deliberately NOT activated here: V4 will not claim view-once until
-- a dedicated one-view authorization ledger exists. If encountered, it is
-- normalized to the implemented 24-hour ephemeral mode rather than pretending.
create or replace function public.apply_chat_message_retention_defaults()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  settings public.conversation_chat_settings%rowtype;
  lifetime_expiry timestamptz;
begin
  select * into settings
  from public.conversation_chat_settings
  where conversation_id = new.conversation_id;

  if found and settings.message_lifetime_seconds is not null and new.expires_at is null then
    lifetime_expiry := now() + make_interval(secs => settings.message_lifetime_seconds);
    new.expires_at := lifetime_expiry;
  end if;

  if new.message_type in ('image', 'video', 'file', 'drawing') then
    if found and new.media_mode = 'keep' then
      if settings.default_media_mode = '24h' then
        new.media_mode := '24h';
      elsif settings.default_media_mode = 'view_once' then
        -- View-once is not surfaced until one-view authorization is real.
        new.media_mode := '24h';
      end if;
    end if;

    if new.media_mode = 'view_once' then
      new.media_mode := '24h';
    end if;

    if new.media_mode = '24h' then
      if new.expires_at is null or new.expires_at > now() + interval '24 hours' then
        new.expires_at := now() + interval '24 hours';
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists chats_v4_message_retention_defaults on public.messages;
create trigger chats_v4_message_retention_defaults
before insert on public.messages
for each row
execute function public.apply_chat_message_retention_defaults();

revoke all on function public.apply_chat_message_retention_defaults() from public, anon, authenticated;
