-- Chats Ultimate foundation.
--
-- Additive schema for the approved WhatsApp + Snapchat-inspired messaging
-- direction. This migration deliberately creates durable server contracts
-- BEFORE the UI is allowed to present the features as working.
--
-- Included:
--   * per-user conversation preferences/drafts/reading anchors
--   * conversation lifetime + group capability settings
--   * saved/starred messages and folders
--   * pinned conversation content
--   * generic chat polls + options + votes
--   * realtime presence/typing leases
--   * structured contact/place/event/file payloads
--   * richer message types, media modes, expiry and forwarding metadata
--   * video/document MIME support in media_assets
--
-- NOT included on purpose:
--   * exact/live GPS coordinates. Mad Buddy's privacy model does not expose
--     them; message_places stores a user-chosen place/area label only.
--   * end-to-end encryption. The existing messaging architecture is transport
--     encrypted + server-authorized, not E2EE. E2EE requires a separate key
--     architecture and must never be represented by a cosmetic toggle.
--
-- Existing data is untouched. All new columns are nullable or have safe
-- defaults; constraint widening only ADDS valid message/media types.

-- ---------------------------------------------------------------------------
-- 1. Widen media and message content types.
-- ---------------------------------------------------------------------------

alter table public.media_assets drop constraint if exists media_assets_content_type_check;
alter table public.media_assets add constraint media_assets_content_type_check check (
  content_type in (
    'image/jpeg', 'image/png', 'image/webp',
    'audio/webm', 'audio/mpeg', 'audio/mp4', 'audio/ogg',
    'video/mp4', 'video/webm', 'video/quicktime',
    'application/pdf', 'text/plain',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  )
);

alter table public.messages drop constraint if exists messages_message_type_check;
alter table public.messages add constraint messages_message_type_check check (
  message_type in (
    'text', 'image', 'voice_note', 'system', 'quick_action',
    'video', 'file', 'contact', 'poll', 'event', 'place', 'drawing'
  )
);

alter table public.messages
  add column if not exists media_mode text not null default 'keep',
  add column if not exists expires_at timestamptz,
  add column if not exists kept_at timestamptz,
  add column if not exists kept_by uuid references auth.users(id) on delete set null,
  add column if not exists forwarded_from_message_id uuid references public.messages(id) on delete set null;

alter table public.messages drop constraint if exists messages_media_mode_check;
alter table public.messages add constraint messages_media_mode_check check (
  media_mode in ('keep', 'view_once', '24h')
);

alter table public.messages drop constraint if exists messages_has_content;
alter table public.messages add constraint messages_has_content check (
  message_type = 'system'
  or message_type = 'quick_action'
  or (message_type = 'text' and text_content is not null and char_length(btrim(text_content)) > 0)
  or (message_type in ('image', 'voice_note', 'video', 'file', 'drawing') and media_id is not null)
  or message_type in ('contact', 'poll', 'event', 'place')
);

alter table public.messages drop constraint if exists messages_system_event_type_check;
alter table public.messages add constraint messages_system_event_type_check check (
  system_event_type is null or system_event_type in (
    'plan_confirmed', 'plan_time_changed', 'plan_place_changed', 'plan_cancelled',
    'poll_confirmed', 'participant_joined', 'participant_left', 'conversation_created',
    'message_pinned', 'message_unpinned', 'chat_poll_created', 'chat_poll_closed',
    'message_lifetime_changed', 'member_added', 'member_removed',
    'member_promoted', 'member_demoted'
  )
);

create index if not exists messages_expires_at_idx
  on public.messages(expires_at)
  where expires_at is not null and deleted_at is null;

-- ---------------------------------------------------------------------------
-- 2. Per-conversation shared settings.
-- ---------------------------------------------------------------------------

create table if not exists public.conversation_chat_settings (
  conversation_id uuid primary key references public.conversations(id) on delete cascade,
  -- NULL means durable/forever. Custom values are intentionally allowed so
  -- the UI can support 24h / 7d / 30d AND a future custom duration without a
  -- schema change. One minute is the lower safety floor; one year the upper.
  message_lifetime_seconds integer check (
    message_lifetime_seconds is null
    or message_lifetime_seconds between 60 and 31536000
  ),
  default_media_mode text not null default 'keep' check (
    default_media_mode in ('keep', 'view_once', '24h')
  ),
  who_can_pin text not null default 'all_members' check (
    who_can_pin in ('all_members', 'admins', 'owner', 'disabled')
  ),
  who_can_create_polls text not null default 'all_members' check (
    who_can_create_polls in ('all_members', 'admins', 'owner', 'disabled')
  ),
  who_can_use_everyone text not null default 'admins' check (
    who_can_use_everyone in ('all_members', 'admins', 'owner', 'disabled')
  ),
  who_can_add_members text not null default 'admins' check (
    who_can_add_members in ('all_members', 'admins', 'owner', 'disabled')
  ),
  who_can_edit_info text not null default 'admins' check (
    who_can_edit_info in ('admins', 'owner')
  ),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.conversation_chat_settings enable row level security;

create policy "chat settings visible to members" on public.conversation_chat_settings
  for select using (public.is_conversation_member(conversation_id));

-- Writes intentionally have no authenticated RLS policy. Server actions use
-- the service role after applying role/permission rules so a forged client
-- cannot make itself an admin by writing settings directly.

-- ---------------------------------------------------------------------------
-- 3. Per-user conversation preferences, durable drafts and read anchors.
-- ---------------------------------------------------------------------------

create table if not exists public.conversation_user_preferences (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  archived_at timestamptz,
  marked_unread_at timestamptz,
  favorite_rank integer check (favorite_rank is null or favorite_rank between 0 and 9999),
  theme_key text not null default 'default' check (char_length(theme_key) between 1 and 64),
  notification_preview text not null default 'when_unlocked' check (
    notification_preview in ('always', 'when_unlocked', 'never')
  ),
  notify_mentions_when_muted boolean not null default true,
  notify_replies_when_muted boolean not null default true,
  draft_text text check (draft_text is null or char_length(draft_text) <= 10000),
  draft_updated_at timestamptz,
  reading_anchor_message_id uuid references public.messages(id) on delete set null,
  reading_anchor_offset integer not null default 0,
  voice_playback_message_id uuid references public.messages(id) on delete set null,
  voice_playback_seconds numeric(9,3) not null default 0 check (voice_playback_seconds >= 0),
  updated_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create index if not exists conversation_user_preferences_user_idx
  on public.conversation_user_preferences(user_id, archived_at, favorite_rank);

alter table public.conversation_user_preferences enable row level security;

create policy "conversation preferences owner read" on public.conversation_user_preferences
  for select using (auth.uid() = user_id and public.is_conversation_member(conversation_id));
create policy "conversation preferences owner insert" on public.conversation_user_preferences
  for insert with check (auth.uid() = user_id and public.is_conversation_member(conversation_id));
create policy "conversation preferences owner update" on public.conversation_user_preferences
  for update using (auth.uid() = user_id and public.is_conversation_member(conversation_id))
  with check (auth.uid() = user_id and public.is_conversation_member(conversation_id));
create policy "conversation preferences owner delete" on public.conversation_user_preferences
  for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 4. Saved/starred messages and folders.
-- ---------------------------------------------------------------------------

create table if not exists public.saved_message_folders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name)
);

create table if not exists public.saved_messages (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  folder_id uuid references public.saved_message_folders(id) on delete set null,
  saved_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

create index if not exists saved_messages_user_idx on public.saved_messages(user_id, saved_at desc);

alter table public.saved_message_folders enable row level security;
alter table public.saved_messages enable row level security;

create policy "saved folders owner access" on public.saved_message_folders
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "saved messages owner read" on public.saved_messages
  for select using (
    auth.uid() = user_id
    and exists (
      select 1 from public.messages m
      where m.id = saved_messages.message_id
        and public.is_conversation_member(m.conversation_id)
    )
  );
create policy "saved messages owner insert" on public.saved_messages
  for insert with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.messages m
      where m.id = saved_messages.message_id
        and public.is_conversation_member(m.conversation_id)
    )
  );
create policy "saved messages owner delete" on public.saved_messages
  for delete using (auth.uid() = user_id);
create policy "saved messages owner update" on public.saved_messages
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 5. Pinned conversation content.
-- ---------------------------------------------------------------------------

create table if not exists public.conversation_pins (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  pinned_by uuid references auth.users(id) on delete set null,
  pinned_at timestamptz not null default now(),
  unique (conversation_id, message_id)
);

create index if not exists conversation_pins_conversation_idx
  on public.conversation_pins(conversation_id, pinned_at desc);

alter table public.conversation_pins enable row level security;
create policy "conversation pins visible to members" on public.conversation_pins
  for select using (public.is_conversation_member(conversation_id));
-- Pin/unpin writes are server-authorized against conversation settings + role.

-- ---------------------------------------------------------------------------
-- 6. Generic chat polls.
-- ---------------------------------------------------------------------------

create table if not exists public.chat_polls (
  -- The poll id IS the message id. This keeps one canonical timeline item and
  -- makes delete-for-everyone cascade the structured payload automatically.
  message_id uuid primary key references public.messages(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  question text not null check (char_length(question) between 1 and 240),
  allow_multiple boolean not null default false,
  is_anonymous boolean not null default false,
  closed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.chat_poll_options (
  id uuid primary key default gen_random_uuid(),
  poll_message_id uuid not null references public.chat_polls(message_id) on delete cascade,
  label text not null check (char_length(label) between 1 and 120),
  position smallint not null check (position between 0 and 30),
  created_at timestamptz not null default now(),
  unique (poll_message_id, position)
);

create table if not exists public.chat_poll_votes (
  poll_message_id uuid not null references public.chat_polls(message_id) on delete cascade,
  option_id uuid not null references public.chat_poll_options(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (poll_message_id, option_id, user_id)
);

create index if not exists chat_polls_conversation_idx on public.chat_polls(conversation_id, created_at desc);
create index if not exists chat_poll_votes_poll_idx on public.chat_poll_votes(poll_message_id);

alter table public.chat_polls enable row level security;
alter table public.chat_poll_options enable row level security;
alter table public.chat_poll_votes enable row level security;

create policy "chat polls visible to members" on public.chat_polls
  for select using (public.is_conversation_member(conversation_id));
create policy "chat poll options visible to members" on public.chat_poll_options
  for select using (
    exists (
      select 1 from public.chat_polls p
      where p.message_id = chat_poll_options.poll_message_id
        and public.is_conversation_member(p.conversation_id)
    )
  );
create policy "chat poll votes visible to members" on public.chat_poll_votes
  for select using (
    exists (
      select 1 from public.chat_polls p
      where p.message_id = chat_poll_votes.poll_message_id
        and public.is_conversation_member(p.conversation_id)
    )
  );
create policy "chat poll votes owner insert" on public.chat_poll_votes
  for insert with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.chat_polls p
      where p.message_id = chat_poll_votes.poll_message_id
        and p.closed_at is null
        and public.is_conversation_member(p.conversation_id)
    )
  );
create policy "chat poll votes owner delete" on public.chat_poll_votes
  for delete using (auth.uid() = user_id);
-- Poll creation/closure is server-authorized to enforce per-group capabilities.

-- ---------------------------------------------------------------------------
-- 7. Presence + typing leases.
-- ---------------------------------------------------------------------------

create table if not exists public.conversation_presence (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  presence_state text not null default 'in_chat' check (
    presence_state in ('active', 'in_chat')
  ),
  present_until timestamptz not null,
  typing_until timestamptz,
  last_active_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create index if not exists conversation_presence_live_idx
  on public.conversation_presence(conversation_id, present_until desc);

alter table public.conversation_presence enable row level security;

create policy "conversation presence visible to members" on public.conversation_presence
  for select using (public.is_conversation_member(conversation_id));
create policy "conversation presence owner insert" on public.conversation_presence
  for insert with check (auth.uid() = user_id and public.is_conversation_member(conversation_id));
create policy "conversation presence owner update" on public.conversation_presence
  for update using (auth.uid() = user_id and public.is_conversation_member(conversation_id))
  with check (auth.uid() = user_id and public.is_conversation_member(conversation_id));
create policy "conversation presence owner delete" on public.conversation_presence
  for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 8. Structured payloads. These contain only what the sender explicitly chose
-- to share. Place payloads deliberately contain NO latitude/longitude.
-- ---------------------------------------------------------------------------

create table if not exists public.message_files (
  message_id uuid primary key references public.messages(id) on delete cascade,
  media_id uuid not null references public.media_assets(id) on delete cascade,
  file_name text not null check (char_length(file_name) between 1 and 255),
  mime_type text not null check (char_length(mime_type) between 1 and 120),
  byte_size bigint not null check (byte_size between 1 and 104857600),
  page_count integer check (page_count is null or page_count between 1 and 10000)
);

create table if not exists public.message_contacts (
  message_id uuid primary key references public.messages(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 120),
  phone text check (phone is null or char_length(phone) <= 40),
  email text check (email is null or char_length(email) <= 254),
  organization text check (organization is null or char_length(organization) <= 120)
);

create table if not exists public.message_places (
  message_id uuid primary key references public.messages(id) on delete cascade,
  place_name text not null check (char_length(place_name) between 1 and 160),
  area_label text check (area_label is null or char_length(area_label) <= 160),
  address_label text check (address_label is null or char_length(address_label) <= 240),
  place_kind text not null default 'venue' check (place_kind in ('venue', 'area'))
);

create table if not exists public.message_event_refs (
  message_id uuid primary key references public.messages(id) on delete cascade,
  event_id uuid references public.events(id) on delete cascade,
  plan_id uuid references public.plans(id) on delete cascade,
  constraint message_event_refs_exactly_one check (
    (event_id is not null and plan_id is null)
    or (event_id is null and plan_id is not null)
  )
);

alter table public.message_files enable row level security;
alter table public.message_contacts enable row level security;
alter table public.message_places enable row level security;
alter table public.message_event_refs enable row level security;

create policy "message files visible with message" on public.message_files
  for select using (
    exists (select 1 from public.messages m where m.id = message_files.message_id and public.is_conversation_member(m.conversation_id))
  );
create policy "message contacts visible with message" on public.message_contacts
  for select using (
    exists (select 1 from public.messages m where m.id = message_contacts.message_id and public.is_conversation_member(m.conversation_id))
  );
create policy "message places visible with message" on public.message_places
  for select using (
    exists (select 1 from public.messages m where m.id = message_places.message_id and public.is_conversation_member(m.conversation_id))
  );
create policy "message event refs visible with message" on public.message_event_refs
  for select using (
    exists (select 1 from public.messages m where m.id = message_event_refs.message_id and public.is_conversation_member(m.conversation_id))
  );

-- ---------------------------------------------------------------------------
-- 9. Useful cleanup helpers for ephemeral presence and expired messages.
-- These functions mutate only rows that are ALREADY expired; schedulers may
-- call them later without learning anything about conversations.
-- ---------------------------------------------------------------------------

create or replace function public.cleanup_expired_conversation_presence()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  removed integer;
begin
  delete from public.conversation_presence where present_until < now() - interval '5 minutes';
  get diagnostics removed = row_count;
  return removed;
end;
$$;

create or replace function public.expire_chat_messages()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  changed integer;
begin
  update public.messages
  set deleted_at = coalesce(deleted_at, now()),
      status = case when status = 'removed_by_moderation' then status else 'deleted' end,
      text_content = null
  where expires_at is not null
    and expires_at <= now()
    and kept_at is null
    and deleted_at is null;
  get diagnostics changed = row_count;
  return changed;
end;
$$;

revoke all on function public.cleanup_expired_conversation_presence() from public, anon, authenticated;
revoke all on function public.expire_chat_messages() from public, anon, authenticated;
grant execute on function public.cleanup_expired_conversation_presence() to service_role;
grant execute on function public.expire_chat_messages() to service_role;
