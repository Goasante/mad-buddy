-- Current activation truth: creating a Meetup is the successor to the retired
-- first_plan_created milestone. Preserve old milestone rows for established
-- accounts, but record and backfill the current product fact.

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
      'first_meetup_created',
      'first_message_sent',
      'first_reply_received'
    )
  );

insert into public.activation_milestones (user_id, milestone)
select distinct m.creator_id, 'first_meetup_created'
from public.meetups m
where m.status <> 'cancelled'
on conflict (user_id, milestone) do nothing;
