-- Activation: record that a conversation became two-sided, once.
--
-- WHY (MB-GOD-060). `loadMaturityEvidence` answered one question on EVERY Home
-- load for every account with a Muddy:
--
--     has any direct conversation of mine ever had two different senders?
--
-- It answered it by reading `conversation_id, sender_id` for every non-system,
-- non-deleted message in every direct conversation the user belongs to, then
-- grouping in application memory. That is O(total messages this person has ever
-- exchanged) per render -- no time window, no limit. A two-year user with 20
-- conversations averaging 500 messages would make Home read 10,000 rows to
-- produce one boolean.
--
-- The defect was never the query, which is correct and batched. It is that a
-- MONOTONIC DERIVED FACT was being recomputed from raw history every time.
--
-- `home-maturity.ts` only ever compares `twoSidedConversationCount > 0`; the
-- number itself is never used. And the fact is monotonic: `looksEstablished`
-- asks what somebody has EVER experienced, so once a conversation of theirs has
-- been two-sided it can never stop having been.
--
-- A milestone is therefore the right authority, and this table is the existing
-- one -- no second maturity system is introduced.
--
-- BACKFILL, unlike 20260816120000_first_message_sent_milestone.
--
-- That migration deliberately did NOT backfill, reasoning that "a milestone
-- means this happened AND we were watching, and inventing rows for messages
-- sent before the milestone existed would be a guess presented as evidence".
-- That reasoning is right for `first_message_sent`, whose truth condition is an
-- ACT we were not observing at the time.
--
-- This case is the opposite: the truth condition is a STATE that is still fully
-- present in the data. Whether a conversation has two distinct senders is not a
-- guess -- it is a fact the rows still assert. Backfilling reads that fact once,
-- here, instead of on every Home load forever.
--
-- Backfilling is also REQUIRED for correctness, not merely for tidiness.
-- `deriveHomeMaturity` checks `looksEstablished` BEFORE the milestone check
-- precisely so that long-standing accounts are not re-onboarded. If the runtime
-- read is replaced by a milestone and existing users have no row, every
-- established user would be demoted to `activating` on their next Home load --
-- exactly the regression that comment exists to prevent.

-- 1. Widen the constraint. Additive only: every existing name is preserved.
alter table public.activation_milestones
  drop constraint if exists activation_milestones_milestone_check;

alter table public.activation_milestones
  add constraint activation_milestones_milestone_check check (
    milestone in (
      'account_created',
      'email_verified',
      'profile_completed',
      'privacy_setup_completed',
      'first_request_sent',
      'first_request_accepted',
      'first_muddy_added',
      'first_status_created',
      'first_wave_sent',
      'first_glow_enabled',
      'first_plan_created',
      'first_message_sent',
      -- New: a DIRECT conversation this person belongs to has had messages from
      -- two different senders. "Somebody replied" -- the completed loop that
      -- distinguishes a relationship from talking into silence.
      --
      -- Direct only. Plan and Circle chat are inherently multi-party and would
      -- make this true for anybody merely present in a group, which is not the
      -- same social fact.
      'first_reply_received'
    )
  );

-- 2. Backfill, once, from the data that already proves it.
--
-- Reads the same predicate the runtime scan used: non-system, non-deleted
-- messages in DIRECT conversations, grouped by conversation, keeping those with
-- more than one distinct sender. Every JOINED member of such a conversation has
-- experienced a two-sided conversation.
--
-- `on conflict do nothing` against UNIQUE (user_id, milestone) makes this
-- idempotent: re-running the migration, or running it after the trigger has
-- already fired for somebody, changes nothing.
--
-- `reached_at` is left to its column default rather than being invented from
-- message timestamps. The honest claim is "this was true when we looked", not a
-- fabricated moment -- and nothing reads this milestone's timestamp.
insert into public.activation_milestones (user_id, milestone)
select distinct cm.user_id, 'first_reply_received'
from public.conversation_members cm
where cm.status = 'joined'
  and exists (
    select 1
    from public.conversations c
    where c.id = cm.conversation_id
      and c.conversation_type = 'direct'
  )
  and (
    select count(distinct m.sender_id)
    from public.messages m
    where m.conversation_id = cm.conversation_id
      and m.message_type <> 'system'
      and m.deleted_at is null
      and m.sender_id is not null
  ) > 1
on conflict (user_id, milestone) do nothing;

-- 3. Keep it true going forward, at the moment it becomes true.
--
-- A trigger rather than application code, deliberately: messages are inserted
-- from several paths (direct send, Linkr connection greeting, the mobile API),
-- and a milestone written in one of them would silently miss the others. The
-- database is the one place every insert passes through.
--
-- SECURITY DEFINER with a pinned search_path: the function writes to a table
-- the message sender may not hold direct rights on, and an unpinned
-- search_path on a definer function is an object-resolution hazard.
create or replace function public.record_first_reply_received()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_is_direct boolean;
  v_distinct_senders integer;
begin
  -- System messages are not a person speaking.
  if new.message_type = 'system' or new.sender_id is null then
    return new;
  end if;

  select c.conversation_type = 'direct'
    into v_is_direct
  from public.conversations c
  where c.id = new.conversation_id;

  if not coalesce(v_is_direct, false) then
    return new;
  end if;

  -- Cheap exit: this only becomes true on the message that introduces a SECOND
  -- sender, so the overwhelming majority of inserts stop here after counting a
  -- single conversation's senders -- bounded by that conversation, never by the
  -- user's whole history.
  select count(distinct m.sender_id)
    into v_distinct_senders
  from public.messages m
  where m.conversation_id = new.conversation_id
    and m.message_type <> 'system'
    and m.deleted_at is null
    and m.sender_id is not null;

  if v_distinct_senders < 2 then
    return new;
  end if;

  -- Both sides have now spoken: every joined member has experienced it.
  insert into public.activation_milestones (user_id, milestone)
  select cm.user_id, 'first_reply_received'
  from public.conversation_members cm
  where cm.conversation_id = new.conversation_id
    and cm.status = 'joined'
  on conflict (user_id, milestone) do nothing;

  return new;
end;
$$;

-- Least privilege: nothing may call this directly. It runs only as a trigger.
revoke all on function public.record_first_reply_received() from public;
revoke all on function public.record_first_reply_received() from anon;
revoke all on function public.record_first_reply_received() from authenticated;

drop trigger if exists messages_record_first_reply_received on public.messages;
create trigger messages_record_first_reply_received
  after insert on public.messages
  for each row
  execute function public.record_first_reply_received();

-- ROLLBACK (for the production application order, not run here):
--   drop trigger if exists messages_record_first_reply_received on public.messages;
--   drop function if exists public.record_first_reply_received();
--   delete from public.activation_milestones where milestone = 'first_reply_received';
--   -- then restore the previous constraint without 'first_reply_received'
-- The application tolerates the milestone being absent: `looksEstablished`
-- falls back to plan participation, so a rollback degrades rather than breaks.
