-- Plan Chat closure lifecycle.
--
-- THE PRODUCT RULE. A Plan Chat should not stay open forever. Some days after
-- the Plan ends it CLOSES: no new messages, and it leaves the active inbox.
-- It is never deleted, and no message in it is ever deleted -- every member
-- keeps reading the whole history through the existing Archived view.
--
-- WHY SO LITTLE SCHEMA. The audit found that almost every authority this
-- feature needs already exists:
--
--   * conversations.status = 'archived' ALREADY blocks sending. Every send
--     path -- text, media, forwards, structured shares, polls, voice -- funnels
--     through canSendMessage -> resolveCanSendMessage, which refuses anything
--     whose conversation status is not 'active'. applyBlockToConversations
--     already closes a chat this exact way when someone is blocked.
--   * conversation_user_preferences.archived_at ALREADY removes a conversation
--     from the active inbox and files it under the existing "Archived" filter,
--     which is also how it stays discoverable.
--   * lib/social/plans.ts planPhase() ALREADY resolves when a Plan ends,
--     including the `end_at ?? start_at + 3h` fallback and the 14-day grace for
--     undated plans.
--
-- So the ONLY thing with nowhere to live is the owner's choice of window. That
-- is what this migration adds, and nothing else.
--
-- WHY A DAY COUNT AND NOT A TIMESTAMP. Two reasons, both load-bearing:
--
--   1. A Plan's start time can still move after creation: confirmPollAction
--      writes the winning option into plans.start_at when a time or date poll
--      resolves. A close instant frozen at creation would be stale for exactly
--      the plans that needed the poll. Storing the WINDOW and deriving the
--      instant means a resolved poll reschedules the closure for free.
--   2. A client can never propose a close time. It picks one of four numbers;
--      the server computes the instant. There is no timestamp on the wire to
--      forge, and the check constraint makes an out-of-range value impossible
--      even if every layer above it were bypassed.
--
-- NOT A RETENTION FIELD. This is deliberately not expressed through, and never
-- read alongside, the 24h-message / Keep-in-Chat / media-expiry columns. Those
-- decide whether CONTENT survives; this decides whether the ROOM is open.

-- ---------------------------------------------------------------------------
-- 1. The owner's chosen window.
-- ---------------------------------------------------------------------------
alter table public.plans
  add column if not exists chat_close_days smallint not null default 3;

-- Four windows, enforced in the database as well as in the action. A forged
-- value cannot be stored even if it reached this far.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'plans_chat_close_days_allowed'
  ) then
    alter table public.plans
      add constraint plans_chat_close_days_allowed
      check (chat_close_days in (1, 3, 7, 14));
  end if;
end $$;

comment on column public.plans.chat_close_days is
  'Days after the Plan ends that its Plan Chat closes (read-only + archived). One of 1/3/7/14; the close instant is derived, never stored, so a rescheduled Plan moves its own closure.';

-- ---------------------------------------------------------------------------
-- 2. The scheduled lookup.
--
-- The closure job must find due Plan Chats without scanning conversations. It
-- walks plans (which carry the timing) and joins to the one conversation each
-- has, so the index that matters is the one that lets it skip plans whose
-- chats are already closed and plans that have not ended.
--
-- Partial: only plans that could still own an OPEN chat. Terminal plans are
-- included because a cancelled plan closes its chat promptly and the job is
-- what does it -- but a plan already swept is excluded by the conversation's
-- own status, which the join checks.
-- ---------------------------------------------------------------------------
create index if not exists plans_chat_closure_idx
  on public.plans(status, start_at, end_at);

-- Lets the job resolve "the conversation for these plans" in one indexed pass
-- rather than a sequential scan of conversations. The existing
-- conversations_context_unique index is partial on conversation_type in
-- ('plan','event'); this one is narrower and covers status so the job can ask
-- for active Plan Chats directly.
create index if not exists conversations_plan_active_idx
  on public.conversations(context_id)
  where context_type = 'plan' and status = 'active';

-- ---------------------------------------------------------------------------
-- 3. Existing Plan Chats.
--
-- NO BACKFILL WRITE IS NEEDED FOR THE WINDOW: the column defaults to 3, which
-- is the product default, so every existing Plan already has the right answer.
--
-- NO BACKFILL WRITE IS PERFORMED FOR CLOSURE EITHER, deliberately. Plans that
-- ended long ago are already past their close time, so the scheduled job will
-- close them on its next tick using exactly the same code path that closes
-- every future one. Doing it here instead would mean the migration and the job
-- were two implementations of one rule -- the precise shape of bug that let a
-- plan be "past" on the Plans page and "inviting" in the database for weeks.
--
-- The job is idempotent and bounded, so this converges within one tick per
-- batch with no destructive statement in the migration at all. Nothing is
-- deleted here, and nothing can be: this file contains no delete and no update.
-- ---------------------------------------------------------------------------
