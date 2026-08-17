-- Activation: recognise a first direct social message.
--
-- Sending a real message to another person is meaningful social interaction;
-- opening a conversation is not. Activation could already see a Wave, a Plan
-- and a status, but a first message -- the most ordinary way somebody actually
-- starts -- had no milestone at all, so a person who said hello and got a
-- reply still counted as not having arrived.
--
-- ADDITIVE ONLY. Every existing name is preserved verbatim; the constraint is
-- recreated purely to widen it. No backfill, no row rewrite, no deletion: a
-- milestone means "this happened AND we were watching", and inventing rows for
-- messages sent before the milestone existed would be a guess presented as
-- evidence.
--
-- The UNIQUE (user_id, milestone) constraint is deliberately untouched -- it is
-- the idempotency authority, and recordMilestone's upsert depends on it.

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
      -- New: one successful user-authored DIRECT message. Plan and Circle chat
      -- have their own lifecycle semantics and are deliberately out of scope.
      'first_message_sent'
    )
  );
