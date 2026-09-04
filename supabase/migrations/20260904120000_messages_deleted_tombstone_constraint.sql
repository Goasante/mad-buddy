-- DELETE FOR EVERYONE was impossible: the schema described a deleted message
-- incorrectly.
--
-- WHAT WENT WRONG. deleteMessageAction tombstones a message with
--
--     status = 'deleted', deleted_at = now(), text_content = null
--
-- but leaves message_type = 'text', because the row keeps its identity. The
-- messages_has_content constraint required EVERY text row to carry non-empty
-- text_content, with no exception for a tombstone, so the UPDATE always
-- failed. The action returned "Couldn't delete that message." and the message
-- stayed in the thread.
--
-- Found by driving a real browser against a real database: send a message,
-- long-press, Delete, "Delete for everyone". Nothing in the client errored --
-- the rejection happened in Postgres and surfaced only as a failure message.
-- Neither source review nor the unit suite caught it, because both agreed with
-- the action's intent; only the live constraint disagreed.
--
-- THE FIX IS THE INVARIANT, NOT A WORKAROUND. A deleted message is a
-- TOMBSTONE, and a tombstone's content is legitimately absent. Writing
-- '[deleted]' into text_content, or flipping message_type to 'system', would
-- make the row lie about itself to satisfy a rule that was wrong. Adding
-- `deleted_at is not null` as the first branch states the truth: content is
-- required while a message is live, and not once it has been deleted.
--
-- The live-message contract is UNCHANGED. Every other branch below is copied
-- verbatim from 20260828191000_chats_ultimate_foundation.sql, so a text row
-- with null or blank content is still rejected, and image/voice/video/file/
-- drawing still require a media_id -- unless the row is a tombstone.
--
-- ROLLBACK (not run here): restore the constraint without the deleted_at
-- branch. That reinstates the defect -- delete-for-everyone starts failing
-- again for every text message.

alter table public.messages drop constraint if exists messages_has_content;

alter table public.messages add constraint messages_has_content check (
  -- A tombstone has no content requirement. This is the only new branch.
  deleted_at is not null
  or message_type = 'system'
  or message_type = 'quick_action'
  or (message_type = 'text' and text_content is not null and char_length(btrim(text_content)) > 0)
  or (message_type in ('image', 'voice_note', 'video', 'file', 'drawing') and media_id is not null)
  or message_type in ('contact', 'poll', 'event', 'place')
);

comment on constraint messages_has_content on public.messages is
  'Live messages must carry their content; deleted rows are tombstones and are exempt. See 20260904120000.';
