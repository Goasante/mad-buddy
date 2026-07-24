-- Expand Mad Buddy's private, non-competitive achievement catalog.
-- Definitions are reference data only. Unlocks are granted from authoritative
-- server actions after the underlying activity has been persisted.

insert into public.achievement_definitions
  (code, name, description, category, criteria_type, criteria_value)
values
  ('first_ping', 'First Ping', 'You sent your first Ping.', 'connection', 'first_time', 1),
  ('thoughtful_reply', 'Thoughtful Reply', 'You replied to your first connection prompt.', 'connection', 'first_time', 1),
  ('close_friend', 'Close Friend', 'You added your first Close Friend.', 'connection', 'first_time', 1),
  ('friendly_five', 'Friendly Five', 'You connected with 5 approved friends.', 'connection', 'count', 5),
  ('plan_regular', 'Plan Regular', 'You completed 10 Plans.', 'connection', 'count', 10),
  ('open_to_plans', 'Open to Plans', 'You turned on Socialize for the first time.', 'connection', 'first_time', 1),
  ('first_moment', 'First Moment', 'You shared your first Moment.', 'community', 'first_time', 1),
  ('moment_maker', 'Moment Maker', 'You shared 10 Moments.', 'community', 'count', 10),
  ('event_explorer', 'Event Explorer', 'You checked in to your first event.', 'community', 'first_time', 1),
  ('event_host', 'Event Host', 'You created your first event.', 'community', 'first_time', 1),
  ('group_member', 'Group Member', 'You joined your first group.', 'community', 'first_time', 1),
  ('group_founder', 'Group Founder', 'You created your first group.', 'community', 'first_time', 1),
  ('privacy_pause', 'Privacy Pause', 'You used Ghost Mode for the first time.', 'privacy', 'first_time', 1),
  ('safe_traveller', 'Safe Traveller', 'You completed 5 Safe Arrivals.', 'safety', 'count', 5),
  ('reliable_watcher', 'Reliable Watcher', 'You watched over 5 Safe Arrival journeys.', 'safety', 'count', 5)
on conflict (code) do update set
  name = excluded.name,
  description = excluded.description,
  category = excluded.category,
  criteria_type = excluded.criteria_type,
  criteria_value = excluded.criteria_value,
  is_active = true,
  updated_at = now();

-- Backfill only from persisted activity. A user who turned achievements off is
-- excluded, and the unique constraint keeps the migration retry-safe.

insert into public.user_achievements (user_id, achievement_code)
select actor.user_id, 'first_ping'
from (
  select sender_id as user_id from public.meeting_pings
  union
  select sender_id as user_id from public.meetup_requests
) actor
where not exists (
  select 1 from public.engagement_preferences ep
  where ep.user_id = actor.user_id and ep.achievements_enabled = false
)
on conflict (user_id, achievement_code) do nothing;

insert into public.user_achievements (user_id, achievement_code)
select distinct responder_id, 'thoughtful_reply'
from public.meeting_ping_responses response
where not exists (
  select 1 from public.engagement_preferences ep
  where ep.user_id = response.responder_id and ep.achievements_enabled = false
)
on conflict (user_id, achievement_code) do nothing;

insert into public.user_achievements (user_id, achievement_code)
select distinct owner_id, 'close_friend'
from public.close_friend_relationships close_friend
where not exists (
  select 1 from public.engagement_preferences ep
  where ep.user_id = close_friend.owner_id and ep.achievements_enabled = false
)
on conflict (user_id, achievement_code) do nothing;

with friendship_counts as (
  select user_id, count(*) as total
  from (
    select user_one_id as user_id from public.friendships
    union all
    select user_two_id as user_id from public.friendships
  ) muddy
  group by user_id
)
insert into public.user_achievements (user_id, achievement_code)
select counts.user_id, 'friendly_five'
from friendship_counts counts
where counts.total >= 5
  and not exists (
    select 1 from public.engagement_preferences ep
    where ep.user_id = counts.user_id and ep.achievements_enabled = false
  )
on conflict (user_id, achievement_code) do nothing;

with completed_plan_participation as (
  select creator_id as user_id, id as plan_id
  from public.plans
  where status = 'completed'
  union
  select participant.user_id, participant.plan_id
  from public.plan_participants participant
  join public.plans plan on plan.id = participant.plan_id
  where plan.status = 'completed' and participant.rsvp_status = 'going'
),
completed_plan_counts as (
  select user_id, count(distinct plan_id) as total
  from completed_plan_participation
  group by user_id
)
insert into public.user_achievements (user_id, achievement_code)
select counts.user_id, 'plan_regular'
from completed_plan_counts counts
where counts.total >= 10
  and not exists (
    select 1 from public.engagement_preferences ep
    where ep.user_id = counts.user_id and ep.achievements_enabled = false
  )
on conflict (user_id, achievement_code) do nothing;

insert into public.user_achievements (user_id, achievement_code)
select distinct user_id, 'open_to_plans'
from public.socialize_sessions socialize
where not exists (
  select 1 from public.engagement_preferences ep
  where ep.user_id = socialize.user_id and ep.achievements_enabled = false
)
on conflict (user_id, achievement_code) do nothing;

insert into public.user_achievements (user_id, achievement_code)
select distinct author_id, 'first_moment'
from public.moments moment
where not exists (
  select 1 from public.engagement_preferences ep
  where ep.user_id = moment.author_id and ep.achievements_enabled = false
)
on conflict (user_id, achievement_code) do nothing;

with moment_counts as (
  select author_id as user_id, count(*) as total
  from public.moments
  group by author_id
)
insert into public.user_achievements (user_id, achievement_code)
select counts.user_id, 'moment_maker'
from moment_counts counts
where counts.total >= 10
  and not exists (
    select 1 from public.engagement_preferences ep
    where ep.user_id = counts.user_id and ep.achievements_enabled = false
  )
on conflict (user_id, achievement_code) do nothing;

insert into public.user_achievements (user_id, achievement_code)
select distinct user_id, 'event_explorer'
from public.check_ins checkin
where checkin.context_type = 'event'
  and not exists (
    select 1 from public.engagement_preferences ep
    where ep.user_id = checkin.user_id and ep.achievements_enabled = false
  )
on conflict (user_id, achievement_code) do nothing;

insert into public.user_achievements (user_id, achievement_code)
select distinct host_id, 'event_host'
from public.events event
where not exists (
  select 1 from public.engagement_preferences ep
  where ep.user_id = event.host_id and ep.achievements_enabled = false
)
on conflict (user_id, achievement_code) do nothing;

insert into public.user_achievements (user_id, achievement_code)
select distinct member.user_id, 'group_member'
from public.conversation_members member
join public.conversations conversation on conversation.id = member.conversation_id
where conversation.conversation_type = 'group'
  and member.status = 'joined'
  and member.role <> 'owner'
  and not exists (
    select 1 from public.engagement_preferences ep
    where ep.user_id = member.user_id and ep.achievements_enabled = false
  )
on conflict (user_id, achievement_code) do nothing;

insert into public.user_achievements (user_id, achievement_code)
select distinct created_by, 'group_founder'
from public.conversations conversation
where conversation.conversation_type = 'group'
  and conversation.created_by is not null
  and not exists (
    select 1 from public.engagement_preferences ep
    where ep.user_id = conversation.created_by and ep.achievements_enabled = false
  )
on conflict (user_id, achievement_code) do nothing;

insert into public.user_achievements (user_id, achievement_code)
select user_id, 'privacy_pause'
from public.profiles profile
where profile.visibility_status = 'ghost'
  and not exists (
    select 1 from public.engagement_preferences ep
    where ep.user_id = profile.user_id and ep.achievements_enabled = false
  )
on conflict (user_id, achievement_code) do nothing;

with completed_journeys as (
  select traveller_id as user_id, count(*) as total
  from public.safe_arrival_sessions
  where status = 'completed'
  group by traveller_id
)
insert into public.user_achievements (user_id, achievement_code)
select journeys.user_id, 'safe_traveller'
from completed_journeys journeys
where journeys.total >= 5
  and not exists (
    select 1 from public.engagement_preferences ep
    where ep.user_id = journeys.user_id and ep.achievements_enabled = false
  )
on conflict (user_id, achievement_code) do nothing;

with watched_journeys as (
  select contact_user_id as user_id, count(*) as total
  from public.safe_arrival_contacts
  where acknowledgement_status = 'watching'
  group by contact_user_id
)
insert into public.user_achievements (user_id, achievement_code)
select watchers.user_id, 'reliable_watcher'
from watched_journeys watchers
where watchers.total >= 5
  and not exists (
    select 1 from public.engagement_preferences ep
    where ep.user_id = watchers.user_id and ep.achievements_enabled = false
  )
on conflict (user_id, achievement_code) do nothing;
