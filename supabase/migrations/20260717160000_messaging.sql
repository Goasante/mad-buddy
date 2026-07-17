-- Messaging, Group Chat, Plan Chat, Voice Notes, Communication Privacy
-- (feature architecture batch 7). Additive: new tables, one new column, and a
-- widened check constraint. Nothing is dropped and no data is lost.
--
-- Two non-table changes, called out explicitly:
--   1. user_preferences gains a `communication_preferences` jsonb column
--      (add-column-if-not-exists; existing rows default to '{}').
--   2. media_assets.content_type's check constraint is WIDENED to allow audio
--      for Voice Notes. This is a drop-and-recreate of the constraint only —
--      it strictly adds allowed values, so every existing row still passes.
--      Written idempotently so it is safe to re-run.
--
-- Honest crypto note (spec §62): this schema stores message text server-side.
-- Messages are protected in transit (HTTPS) and access-controlled by RLS +
-- the application layer. This is NOT end-to-end encryption and must never be
-- described as such.
--
-- Rollback: drop the tables below; the added column and widened constraint can
-- be left in place harmlessly.
--   drop table if exists public.message_reactions, public.message_hides,
--     public.messages, public.group_settings, public.conversation_members,
--     public.conversations cascade;

-- ---------------------------------------------------------------------------
-- Widen media for Voice Notes (spec §44-§47).
-- ---------------------------------------------------------------------------

alter table public.media_assets drop constraint if exists media_assets_content_type_check;
alter table public.media_assets add constraint media_assets_content_type_check check (
  content_type in (
    'image/jpeg', 'image/png', 'image/webp',
    'audio/webm', 'audio/mpeg', 'audio/mp4', 'audio/ogg'
  )
);

-- ---------------------------------------------------------------------------
-- Communication privacy preferences (spec §53-§56).
-- ---------------------------------------------------------------------------

alter table public.user_preferences
  add column if not exists communication_preferences jsonb not null default '{}'::jsonb;

-- ---------------------------------------------------------------------------
-- Conversations + members (spec §18).
-- ---------------------------------------------------------------------------

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  conversation_type text not null check (
    conversation_type in ('direct', 'group', 'plan', 'event', 'safe_arrival')
  ),
  created_by uuid references auth.users(id) on delete set null,
  context_type text check (context_type in ('plan', 'event', 'event_circle', 'safe_arrival', 'ping', 'wave')),
  context_id uuid,
  status text not null default 'active' check (status in ('active', 'archived', 'restricted', 'deleted')),
  -- Canonical "a:b" key (ids sorted) so exactly one direct conversation can
  -- exist per approved pair, even under concurrent first-messages (spec §4).
  direct_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_message_at timestamptz
);

create unique index if not exists conversations_direct_unique
  on public.conversations(direct_key)
  where conversation_type = 'direct' and direct_key is not null;

-- One conversation per plan / event circle context.
create unique index if not exists conversations_context_unique
  on public.conversations(context_type, context_id)
  where context_type is not null and context_id is not null
    and conversation_type in ('plan', 'event');

create table if not exists public.conversation_members (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'moderator', 'member')),
  status text not null default 'joined' check (
    status in ('invited', 'joined', 'left', 'removed', 'banned')
  ),
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  muted_until timestamptz,
  last_read_message_id uuid,
  read_receipts_enabled boolean not null default true,
  -- New members see messages from when they joined by default (spec §29).
  history_visible_from timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint conversation_members_unique unique (conversation_id, user_id)
);

create table if not exists public.group_settings (
  conversation_id uuid primary key references public.conversations(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  description text check (char_length(description) <= 500),
  image_media_id uuid references public.media_assets(id) on delete set null,
  join_mode text not null default 'invite' check (join_mode in ('invite', 'link', 'closed')),
  history_visibility text not null default 'since_join' check (
    history_visibility in ('since_join', 'full', 'none')
  ),
  posting_mode text not null default 'all_members' check (
    posting_mode in ('all_members', 'admins_only', 'moderated')
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists conversations_last_message_idx on public.conversations(last_message_at desc);
create index if not exists conversation_members_user_idx on public.conversation_members(user_id, status);
create index if not exists conversation_members_conversation_idx
  on public.conversation_members(conversation_id, status);

alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.group_settings enable row level security;

-- Membership is never trusted from the client (spec §20); these policies are
-- the floor and the application layer (service role) is authoritative.
create policy "conversations visible to members" on public.conversations
  for select using (
    exists (
      select 1 from public.conversation_members m
      where m.conversation_id = conversations.id
        and m.user_id = auth.uid()
        and m.status = 'joined'
    )
  );

create policy "conversation members visible to members" on public.conversation_members
  for select using (
    auth.uid() = user_id
    or exists (
      select 1 from public.conversation_members m
      where m.conversation_id = conversation_members.conversation_id
        and m.user_id = auth.uid()
        and m.status = 'joined'
    )
  );

-- A member may update only their own row (mute, read state, receipts).
create policy "conversation members update own row" on public.conversation_members
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "group settings visible to members" on public.group_settings
  for select using (
    exists (
      select 1 from public.conversation_members m
      where m.conversation_id = group_settings.conversation_id
        and m.user_id = auth.uid()
        and m.status = 'joined'
    )
  );

-- ---------------------------------------------------------------------------
-- Messages (spec §18, §50).
-- ---------------------------------------------------------------------------

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid references auth.users(id) on delete set null,
  message_type text not null default 'text' check (
    message_type in ('text', 'image', 'voice_note', 'system', 'quick_action')
  ),
  text_content text check (char_length(text_content) <= 2000),
  media_id uuid references public.media_assets(id) on delete set null,
  reply_to_message_id uuid references public.messages(id) on delete set null,
  -- System messages are server-generated only (spec §40).
  system_event_type text check (
    system_event_type in (
      'plan_confirmed', 'plan_time_changed', 'plan_place_changed', 'plan_cancelled',
      'poll_confirmed', 'participant_joined', 'participant_left', 'conversation_created'
    )
  ),
  quick_action_type text check (
    quick_action_type in ('on_my_way', 'im_here', 'running_late', 'where_to_meet', 'cant_make_it', 'start_without_me')
  ),
  -- Voice note metadata (spec §50).
  duration_seconds integer check (duration_seconds between 1 and 300),
  waveform_data jsonb,
  status text not null default 'sent' check (
    status in ('sent', 'delivered', 'read', 'failed', 'deleted', 'removed_by_moderation')
  ),
  -- Idempotency: a retried send can never create a second message (spec §7).
  client_message_id text,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  constraint messages_has_content check (
    message_type = 'system'
    or message_type = 'quick_action'
    or (message_type = 'text' and text_content is not null and char_length(btrim(text_content)) > 0)
    or (message_type in ('image', 'voice_note') and media_id is not null)
  )
);

create unique index if not exists messages_idempotency_unique
  on public.messages(sender_id, client_message_id)
  where client_message_id is not null and sender_id is not null;

create index if not exists messages_conversation_created_idx
  on public.messages(conversation_id, created_at desc);

create table if not exists public.message_reactions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  reaction_type text not null check (reaction_type in ('heart', 'laugh', 'thumbs_up', 'wave', 'fire', 'wow')),
  created_at timestamptz not null default now(),
  -- One reaction per user per message (spec §15).
  constraint message_reactions_unique unique (message_id, user_id)
);

-- "Delete for me" — hides for one user without touching the other's copy (§14).
create table if not exists public.message_hides (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint message_hides_unique unique (message_id, user_id)
);

create index if not exists message_reactions_message_idx on public.message_reactions(message_id);
create index if not exists message_hides_user_idx on public.message_hides(user_id);

alter table public.messages enable row level security;
alter table public.message_reactions enable row level security;
alter table public.message_hides enable row level security;

-- A member may read messages in their conversations, from their history
-- cut-off onward (spec §29). Blocks are applied in the application layer.
create policy "messages visible to members" on public.messages
  for select using (
    exists (
      select 1 from public.conversation_members m
      where m.conversation_id = messages.conversation_id
        and m.user_id = auth.uid()
        and m.status = 'joined'
        and messages.created_at >= m.history_visible_from
    )
  );

create policy "messages insert by member sender" on public.messages
  for insert with check (
    auth.uid() = sender_id
    and exists (
      select 1 from public.conversation_members m
      where m.conversation_id = messages.conversation_id
        and m.user_id = auth.uid()
        and m.status = 'joined'
    )
  );

create policy "messages update own" on public.messages
  for update using (auth.uid() = sender_id) with check (auth.uid() = sender_id);

create policy "message reactions visible to members" on public.message_reactions
  for select using (
    exists (
      select 1 from public.messages msg
      join public.conversation_members m on m.conversation_id = msg.conversation_id
      where msg.id = message_reactions.message_id
        and m.user_id = auth.uid()
        and m.status = 'joined'
    )
  );

create policy "message reactions owned by reactor" on public.message_reactions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "message hides owner access" on public.message_hides
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
