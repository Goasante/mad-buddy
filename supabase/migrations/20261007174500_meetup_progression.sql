-- Move active progression from retired Plans / Safe Arrival to Meetups.

alter table public.buddy_score_ledger
  drop constraint if exists buddy_score_ledger_event_type_check;

alter table public.buddy_score_ledger
  add constraint buddy_score_ledger_event_type_check check (event_type in (
    'email_verified', 'profile_completed', 'account_quarter', 'friendship_accepted',
    'meetup_completed', 'plan_completed', 'safe_arrival_completed', 'achievement_earned',
    'admin_correction', 'moderation_penalty'
  ));

update public.achievement_definitions
set is_active = false,
    updated_at = now()
where code in ('first_plan','plan_maker','plan_regular');

update public.achievement_definitions
set name = case code
      when 'good_check_in' then 'Good Check-In'
      when 'trusted_contact' then 'Trusted Contact'
      when 'safe_traveller' then 'Safe Traveller'
      when 'reliable_watcher' then 'Reliable Watcher'
      else name
    end,
    description = case code
      when 'good_check_in' then 'You completed a travel safety check-in.'
      when 'trusted_contact' then 'You added someone you trust for a travel safety check-in.'
      when 'safe_traveller' then 'You completed 5 travel safety check-ins.'
      when 'reliable_watcher' then 'You supported 5 travel safety check-in journeys.'
      else description
    end,
    is_active = false,
    updated_at = now()
where code in ('good_check_in','trusted_contact','safe_traveller','reliable_watcher');

update public.achievement_definitions
set name = 'Open to Connect',
    description = 'You turned on Linkr for the first time.',
    updated_at = now()
where code = 'open_to_plans';

insert into public.achievement_definitions
  (code, name, description, category, criteria_type, criteria_value, is_active)
values
  ('first_meetup', 'First Meetup', 'You completed your first Meetup.', 'connection', 'first_time', 1, true),
  ('meetup_maker', 'Meetup Maker', 'You completed 5 Meetups.', 'connection', 'count', 5, true),
  ('meetup_regular', 'Meetup Regular', 'You completed 10 Meetups.', 'connection', 'count', 10, true)
on conflict (code) do update
set name = excluded.name,
    description = excluded.description,
    category = excluded.category,
    criteria_type = excluded.criteria_type,
    criteria_value = excluded.criteria_value,
    is_active = true,
    updated_at = now();

-- Preserve earned progress from the predecessor coordination product without
-- keeping its retired labels in the current Achievements experience.
insert into public.user_achievements
  (user_id, achievement_code, earned_at, viewed_at, shared_at, hidden, created_at)
select
  user_id,
  case achievement_code
    when 'first_plan' then 'first_meetup'
    when 'plan_maker' then 'meetup_maker'
    when 'plan_regular' then 'meetup_regular'
  end,
  earned_at,
  viewed_at,
  shared_at,
  hidden,
  created_at
from public.user_achievements
where achievement_code in ('first_plan','plan_maker','plan_regular')
on conflict (user_id, achievement_code) do nothing;
