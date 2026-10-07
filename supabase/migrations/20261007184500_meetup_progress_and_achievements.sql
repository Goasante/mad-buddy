-- Converge Journey / My Progress / Achievements on Meetups while preserving
-- historical rows and internal compatibility keys.

alter table public.buddy_score_ledger
  drop constraint if exists buddy_score_ledger_event_type_check;
alter table public.buddy_score_ledger
  add constraint buddy_score_ledger_event_type_check check (event_type in (
    'email_verified', 'profile_completed', 'account_quarter', 'friendship_accepted',
    'plan_completed', 'safe_arrival_completed', 'meetup_completed', 'achievement_earned',
    'admin_correction', 'moderation_penalty'
  ));

alter table public.activation_milestones
  drop constraint if exists activation_milestones_milestone_check;
alter table public.activation_milestones
  add constraint activation_milestones_milestone_check check (milestone in (
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
    'first_reply_received',
    'first_meetup_created'
  ));

insert into public.achievement_definitions
  (code, name, description, category, criteria_type, criteria_value)
values
  ('first_meetup', 'First Meetup', 'You completed your first Meetup.', 'connection', 'first_time', 1),
  ('meetup_maker', 'Meetup Maker', 'You completed 5 Meetups.', 'connection', 'count', 5),
  ('meetup_regular', 'Meetup Regular', 'You completed 10 Meetups.', 'connection', 'count', 10),
  ('open_to_meetups', 'Open to Meetups', 'You opened Meet New People for the first time.', 'connection', 'first_time', 1)
on conflict (code) do update
set name = excluded.name,
    description = excluded.description,
    category = excluded.category,
    criteria_type = excluded.criteria_type,
    criteria_value = excluded.criteria_value,
    is_active = true,
    updated_at = now();

-- Historical awards stay attached to the activity that earned them, but the
-- retired product names no longer surface in the current achievement catalogue.
update public.achievement_definitions set
  name = case code
    when 'first_plan' then 'Early Social Step'
    when 'plan_maker' then 'Social Follow-Through'
    when 'plan_regular' then 'Social Rhythm'
    when 'open_to_plans' then 'Open to Connecting'
    when 'safe_traveller' then 'Safety Regular'
    when 'reliable_watcher' then 'Reliable Support'
    else name
  end,
  description = case code
    when 'first_plan' then 'You completed an earlier Mad Buddy social activity.'
    when 'plan_maker' then 'You completed 5 earlier Mad Buddy social activities.'
    when 'plan_regular' then 'You completed 10 earlier Mad Buddy social activities.'
    when 'open_to_plans' then 'You enabled nearby social discovery in an earlier Mad Buddy experience.'
    when 'good_check_in' then 'You completed an earlier safety check-in.'
    when 'trusted_contact' then 'You added a trusted safety contact.'
    when 'safe_traveller' then 'You completed 5 earlier safety check-ins.'
    when 'reliable_watcher' then 'You supported 5 earlier safety check-in journeys.'
    else description
  end,
  updated_at = now()
where code in (
  'first_plan','plan_maker','plan_regular','open_to_plans',
  'good_check_in','trusted_contact','safe_traveller','reliable_watcher'
);

with completed_meetups as (
  select p.user_id, count(distinct p.meetup_id)::integer as total
  from public.meetup_participants p
  join public.meetups m on m.id = p.meetup_id
  where p.response = 'accepted' and m.status = 'ended'
  group by p.user_id
)
insert into public.user_achievements (user_id, achievement_code)
select c.user_id, 'first_meetup'
from completed_meetups c
where c.total >= 1
  and not exists (
    select 1 from public.engagement_preferences ep
    where ep.user_id = c.user_id and ep.achievements_enabled = false
  )
on conflict (user_id, achievement_code) do nothing;

with completed_meetups as (
  select p.user_id, count(distinct p.meetup_id)::integer as total
  from public.meetup_participants p
  join public.meetups m on m.id = p.meetup_id
  where p.response = 'accepted' and m.status = 'ended'
  group by p.user_id
)
insert into public.user_achievements (user_id, achievement_code)
select c.user_id,
  case when c.total >= 10 then 'meetup_regular' else 'meetup_maker' end
from completed_meetups c
where c.total >= 5
  and not exists (
    select 1 from public.engagement_preferences ep
    where ep.user_id = c.user_id and ep.achievements_enabled = false
  )
on conflict (user_id, achievement_code) do nothing;

-- A 10-Meetup member also earned the 5-Meetup badge.
with completed_meetups as (
  select p.user_id, count(distinct p.meetup_id)::integer as total
  from public.meetup_participants p
  join public.meetups m on m.id = p.meetup_id
  where p.response = 'accepted' and m.status = 'ended'
  group by p.user_id
)
insert into public.user_achievements (user_id, achievement_code)
select c.user_id, 'meetup_maker'
from completed_meetups c
where c.total >= 10
  and not exists (
    select 1 from public.engagement_preferences ep
    where ep.user_id = c.user_id and ep.achievements_enabled = false
  )
on conflict (user_id, achievement_code) do nothing;

insert into public.user_achievements (user_id, achievement_code)
select distinct d.creator_id, 'open_to_meetups'
from public.meetup_discoveries d
where not exists (
  select 1 from public.engagement_preferences ep
  where ep.user_id = d.creator_id and ep.achievements_enabled = false
)
on conflict (user_id, achievement_code) do nothing;
