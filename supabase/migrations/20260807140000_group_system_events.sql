-- Groups 2.0 — Stage 3E: factual system events for group state changes.
--
-- The system-message architecture already exists and is reused untouched:
-- `messages.message_type = 'system'`, a server-only `publishSystemMessage`,
-- and `systemMessageText()` for the wording. What is missing is only the
-- vocabulary — `system_event_type` currently allows plan/poll/participant
-- events, so a role change has no legal value to store.
--
-- This adds the four group-lifecycle events and the two identity ones. It does
-- NOT create a second event stream: `domain_events` remains the audit record
-- (who did what, retained, queryable), while these system messages are the
-- in-thread, user-facing projection of the same facts. Two representations of
-- one event, each doing a job the other cannot — an audit log is not readable
-- in a conversation, and a chat message is not an audit trail.
--
-- Privacy shape of these events, enforced by the wording in
-- `systemMessageText()` rather than here: they state WHAT changed and WHO it
-- happened to, never who authorised it and never why. "Kojo was removed" is a
-- fact the group can see; "Ama removed Kojo" invites a conversation about
-- Ama's judgement, and a moderation reason is nobody's business but the
-- moderators'.
--
-- Rollback:
--   Restore the previous check constraint, after deleting any messages using
--   the new values (they would otherwise violate the narrower constraint).

alter table public.messages
  drop constraint if exists messages_system_event_type_check;

alter table public.messages
  add constraint messages_system_event_type_check check (
    system_event_type is null
    or system_event_type in (
      -- Existing vocabulary, unchanged.
      'plan_confirmed',
      'plan_time_changed',
      'plan_place_changed',
      'plan_cancelled',
      'poll_confirmed',
      'participant_joined',
      'participant_left',
      'conversation_created',
      -- Group role lifecycle (Stage 3B actions).
      'member_promoted',
      'member_demoted',
      'ownership_transferred',
      'participant_removed',
      -- Group identity (Stage 3E).
      'group_renamed',
      'group_avatar_changed'
    )
  );

-- ---------------------------------------------------------------------------
-- Idempotency for system events.
-- ---------------------------------------------------------------------------
-- A retried role action must not post the same system message twice. Regular
-- messages already dedupe on (sender_id, client_message_id), but a system
-- message has no sender — sender_id is null, and null never conflicts — so
-- that index cannot protect these.
--
-- This partial unique index covers system messages only, keyed by the
-- conversation and the client_message_id the emitter derives from the event
-- itself. A duplicate insert fails on the index and is swallowed as a no-op.

create unique index if not exists messages_system_event_dedupe_idx
  on public.messages(conversation_id, client_message_id)
  where message_type = 'system' and client_message_id is not null;
