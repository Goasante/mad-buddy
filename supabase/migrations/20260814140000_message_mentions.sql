-- Mentions that survive a change of name.
--
-- A mention has to mean a PERSON, not a piece of text. Parsing "@Ama" out of a
-- message after the fact breaks the moment Ama changes her display name, and
-- it cannot tell one Ama from another. So the relationship is stored:
-- this message mentions this user id.
--
-- NO conversation_id COLUMN, deliberately.
-- The brief asked whether it is needed redundantly. It is not: every mention
-- belongs to exactly one message, and that message already carries the
-- conversation. Storing it twice creates a value that can drift out of
-- agreement with the message it describes, and RLS below reaches the
-- conversation through the message anyway -- the same path the existing
-- "messages visible to members" policy already uses. One fact, one place.
--
-- Rollback: drop table public.message_mentions;

create table if not exists public.message_mentions (
  message_id uuid not null references public.messages(id) on delete cascade,
  mentioned_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  -- Composite key, so mentioning the same person twice in one message stores
  -- one row. Deduplication is structural rather than something the send path
  -- has to remember, which is also what stops a retried send producing a
  -- second mention notification.
  primary key (message_id, mentioned_user_id)
);

-- "What was I mentioned in, most recent first" -- the only query shape the
-- product needs beyond fetching a message's own mentions (served by the PK).
create index if not exists message_mentions_user_idx
  on public.message_mentions (mentioned_user_id, created_at desc);

alter table public.message_mentions enable row level security;

-- READ: exactly the audience that can already read the parent message.
--
-- Delegating to the message rather than restating membership means a mention
-- can never be visible to somebody who cannot see the message containing it,
-- including the history_visible_from rule that hides pre-join history.
create policy "mentions visible with their message" on public.message_mentions
  for select using (
    exists (
      select 1
      from public.messages msg
      join public.conversation_members m
        on m.conversation_id = msg.conversation_id
      where msg.id = message_mentions.message_id
        and m.user_id = auth.uid()
        and m.status = 'joined'
        and msg.created_at >= m.history_visible_from
    )
  );

-- WRITE: server only.
--
-- No insert/update/delete policy is defined, so with RLS enabled every
-- client-side write fails closed. Mentions are created by the canonical send
-- path using the service role, which is what makes "the sender cannot forge a
-- mention of an arbitrary user id" true by construction rather than by
-- validation the client could skip. The server still checks that each
-- mentioned user is a joined member of that conversation -- RLS is the floor,
-- not the whole rule.

comment on table public.message_mentions is
  'Structured @mentions: which users a message names. Identity is the user id, so a display-name change cannot break or misdirect a mention. Rows are server-written only; RLS grants read to exactly the audience of the parent message. Deleting a message removes its mentions by cascade.';
