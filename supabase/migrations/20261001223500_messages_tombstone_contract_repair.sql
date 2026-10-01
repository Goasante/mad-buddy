-- Restore the canonical deleted-message tombstone contract.
--
-- Production/staging drift had reverted messages_has_content to the older
-- live-content-only definition. That made both delete-for-everyone and the
-- chat-expiry sweep fail when they correctly nulled message text.
--
-- A deleted row is a tombstone. Its identity stays so replies/read anchors and
-- structured child revocation remain stable, but content is intentionally gone.

alter table public.messages
  drop constraint if exists messages_has_content;

alter table public.messages
  add constraint messages_has_content check (
    deleted_at is not null
    or message_type = 'system'
    or message_type = 'quick_action'
    or (
      message_type = 'text'
      and text_content is not null
      and char_length(btrim(text_content)) > 0
    )
    or (
      message_type in ('image', 'voice_note', 'video', 'file', 'drawing')
      and media_id is not null
    )
    or message_type in ('contact', 'poll', 'event', 'place')
  );

comment on constraint messages_has_content on public.messages is
  'Live messages must carry their content; deleted rows are tombstones and are exempt.';
