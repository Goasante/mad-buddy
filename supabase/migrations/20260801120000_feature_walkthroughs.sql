-- Canonical first-use feature walkthrough catalogue.
--
-- These are ordinary admin-managed tours. The seed creates published v1
-- records, after which the existing Admin Tours workflow owns drafting,
-- previewing, versioning, publishing, retiring, audit, and analytics.
-- Progress remains one row per user and version in user_tour_progress.
-- Additive and idempotent: no existing tour, version, step, or progress is
-- removed or rewritten.

insert into public.tours (slug, title, description, kind)
values
  ('home-guide', 'Home guide', 'See nearby Muddies and the main controls on Home.', 'feature'),
  ('muddies-guide', 'Muddies guide', 'Learn how approved Muddy relationships work.', 'feature'),
  ('glow-visibility-guide', 'Glow and visibility guide', 'Understand Glow and control who can see it.', 'feature'),
  ('messages-guide', 'Messages guide', 'Find and use private Muddy conversations.', 'feature'),
  ('hangout-guide', 'Hangout guide', 'Share that you are open to something for a limited time.', 'feature'),
  ('socialize-guide', 'Socialize guide', 'Opt in to meet other people who are open to connecting.', 'feature'),
  ('groups-guide', 'Groups guide', 'Use private spaces for conversations and shared plans.', 'feature'),
  ('moments-guide', 'Moments guide', 'Share temporary updates with the people you choose.', 'feature'),
  ('air-guide', 'Air guide', 'Discover public Moments and learn how ON AIR works.', 'feature'),
  ('plans-guide', 'Plans guide', 'Create social plans with your Muddies.', 'feature'),
  ('events-guide', 'Events guide', 'Discover, host, and join current events.', 'feature'),
  ('safe-arrival-guide', 'Safe Arrival guide', 'Let trusted Muddies know you arrived safely.', 'feature'),
  ('profile-guide', 'Profile guide', 'Control how approved Muddies recognise you.', 'feature'),
  ('privacy-safety-guide', 'Privacy and safety guide', 'Review the controls that protect your account and Glow.', 'feature'),
  ('pulse-guide', 'Pulse guide', 'Keep up with requests, alerts, plans, and safety updates.', 'feature'),
  ('badges-guide', 'Achievements guide', 'Understand your private achievements and recaps.', 'feature'),
  ('buddy-score-guide', 'Buddy Score guide', 'Understand your private activity summary.', 'feature'),
  ('settings-guide', 'Settings guide', 'Find account, privacy, notification, and help controls.', 'feature'),
  ('subscription-guide', 'Plan and billing guide', 'Understand your current subscription and available tiers.', 'feature')
on conflict (slug) do nothing;

insert into public.tour_versions (tour_id, version, status, audience, published_at)
select
  t.id,
  1,
  'published',
  '{"plans":["free","buddy_plus","buddy_pro"],"cohort":"all"}'::jsonb,
  now()
from public.tours t
where t.slug in (
  'home-guide', 'muddies-guide', 'glow-visibility-guide', 'messages-guide',
  'hangout-guide', 'socialize-guide', 'groups-guide', 'moments-guide',
  'air-guide', 'plans-guide', 'events-guide', 'safe-arrival-guide',
  'profile-guide', 'privacy-safety-guide', 'pulse-guide', 'badges-guide',
  'buddy-score-guide', 'settings-guide', 'subscription-guide'
)
on conflict (tour_id, version) do nothing;

with seeded_steps (
  tour_slug, position, step_key, title, body, target_id, route,
  requires_feature_flag, entitlement_keys, cta_label, cta_href
) as (values
  -- Home (5)
  ('home-guide', 1, 'nearby', 'Nearby Muddies',
   'Approved Muddies appear here when they are around you. No exact location is shown.',
   'home-nearby', '/dashboard', null, '{}'::text[], null, null),
  ('home-guide', 2, 'glow', 'Read the Glow',
   'A stronger glow means a Muddy is generally closer. A softer glow means farther away.',
   'home-nearby', '/dashboard', null, '{}'::text[], null, null),
  ('home-guide', 3, 'visibility', 'Control visibility',
   'Pause or resume whether approved Muddies can see your general Glow.',
   'home-visibility', '/dashboard', null, '{}'::text[], null, null),
  ('home-guide', 4, 'status', 'Share your status',
   'Use status to show whether you are open, busy, exploring, or quiet.',
   'home-status', '/dashboard', null, '{}'::text[], null, null),
  ('home-guide', 5, 'quick-actions', 'Open a feature',
   'Quick actions take you straight to sharing, planning, safety, and connection tools.',
   'home-quick-actions', '/dashboard', null, '{}'::text[], null, null),

  -- Muddies (4)
  ('muddies-guide', 1, 'approved', 'Your Muddies',
   'Only mutually approved Muddies receive friend-level access.',
   'muddies-list', '/friends', null, '{}'::text[], null, null),
  ('muddies-guide', 2, 'add', 'Add a Muddy',
   'Search by username and send a request. Access begins only after they accept.',
   'muddies-add', '/friends', null, '{}'::text[], null, null),
  ('muddies-guide', 3, 'requests', 'Manage requests',
   'Use these tabs for Muddies, close friends, requests, and blocked accounts.',
   'muddies-tabs', '/friends', null, '{}'::text[], null, null),
  ('muddies-guide', 4, 'profiles', 'Open a profile',
   'Select a Muddy to view the profile information they share with you.',
   'muddies-profile', '/friends', null, '{}'::text[], null, null),

  -- Glow and visibility (4)
  ('glow-visibility-guide', 1, 'overview', 'Glow, not a map',
   'Glow gives you a simple sense of which approved Muddies are around you.',
   'glow-visibility-overview', '/settings/glow-visibility', null, '{}'::text[], null, null),
  ('glow-visibility-guide', 2, 'toggle', 'Pause when needed',
   'Pause Glow at any time, then resume when you are ready.',
   'glow-visibility-toggle', '/settings/glow-visibility', null, '{}'::text[], null, null),
  ('glow-visibility-guide', 3, 'audience', 'Choose your audience',
   'Share with all approved Muddies, close friends, selected circles, or nobody.',
   'glow-visibility-audience', '/settings/glow-visibility', null, '{}'::text[], null, null),
  ('glow-visibility-guide', 4, 'duration', 'Set a time',
   'Choose how long this visibility choice stays active. Style options follow your current plan.',
   'glow-visibility-duration', '/settings/glow-visibility', null, '{}'::text[], null, null),

  -- Messages (6)
  ('messages-guide', 1, 'inbox', 'Private conversations',
   'Your approved Muddy conversations, group chats, and plan chats appear here.',
   'messages-inbox', '/messages', null, '{}'::text[], null, null),
  ('messages-guide', 2, 'search', 'Find a chat',
   'Search your real conversations by name or keyword.',
   'messages-search', '/messages', null, '{}'::text[], null, null),
  ('messages-guide', 3, 'filters', 'Filter the inbox',
   'Switch between all, unread, group, and plan conversations.',
   'messages-filters', '/messages', null, '{}'::text[], null, null),
  ('messages-guide', 4, 'open', 'Open a conversation',
   'Choose a conversation to load its messages and controls.',
   'messages-conversations', '/messages', null, '{}'::text[], null, null),
  ('messages-guide', 5, 'header', 'Conversation controls',
   'The header identifies the chat and contains its information and mute controls.',
   'messages-chat-header', '/messages', null, '{}'::text[], null, null),
  ('messages-guide', 6, 'send', 'Reply your way',
   'Use a quick reply or type a message, then press Send.',
   'messages-composer', '/messages', null, '{}'::text[], null, null),

  -- Hangout (4)
  ('hangout-guide', 1, 'turn-on', 'Turn on Hangout',
   'Let approved Muddies know you are open to doing something for a limited time.',
   'hangout-toggle', '/hangout-mode', null, '{}'::text[], null, null),
  ('hangout-guide', 2, 'details', 'Choose the details',
   'Pick an activity, audience, duration, and optional note in the real setup.',
   null, '/hangout-mode', null, '{}'::text[], null, null),
  ('hangout-guide', 3, 'active', 'Your active Hangout',
   'Update who can see it or turn it off before it expires.',
   'hangout-active', '/hangout-mode', null, '{}'::text[], null, null),
  ('hangout-guide', 4, 'discover', 'See who is open',
   'Active Hangouts from Muddies appear here when available.',
   'hangout-discovery', '/hangout-mode', null, '{}'::text[], null, null),

  -- Socialize (4, entirely behind the managed flag)
  ('socialize-guide', 1, 'activation', 'Opt in to Socialize',
   'Turn it on only when you are open to connecting with people nearby.',
   'socialize-activation', '/discover', 'socialize', '{}'::text[], null, null),
  ('socialize-guide', 2, 'controls', 'Choose the window',
   'Set a broad area and a short visibility period. It turns off when time runs out.',
   'socialize-controls', '/discover', 'socialize', '{}'::text[], null, null),
  ('socialize-guide', 3, 'radar', 'Discover safely',
   'The radar shows general proximity for people who also opted in.',
   'socialize-radar', '/discover', 'socialize', '{}'::text[], null, null),
  ('socialize-guide', 4, 'connect', 'Choose to connect',
   'Wave or send a Muddy request. Socialize never grants friend-level access by itself.',
   'socialize-radar', '/discover', 'socialize', '{}'::text[], null, null),

  -- Groups (4)
  ('groups-guide', 1, 'create', 'Create a group',
   'Start a private space for conversations and shared social plans.',
   'groups-create', '/groups', null, '{}'::text[], null, null),
  ('groups-guide', 2, 'views', 'Choose a group view',
   'Move between your groups, discoverable groups, and invitations.',
   'groups-tabs', '/groups', null, '{}'::text[], null, null),
  ('groups-guide', 3, 'list', 'Your groups',
   'Real groups you belong to appear here.',
   'groups-list', '/groups', null, '{}'::text[], null, null),
  ('groups-guide', 4, 'invites', 'Group invitations',
   'Accept or decline invitations from approved Muddies.',
   'groups-invites', '/groups', null, '{}'::text[], null, null),

  -- Moments (6)
  ('moments-guide', 1, 'feeds', 'Moments feeds',
   'Moments from your Muddies stay separate from the wider Air feed.',
   'moments-tabs', '/moments', null, '{}'::text[], null, null),
  ('moments-guide', 2, 'your-moment', 'Your Moment',
   'Your temporary update starts here. Opening it does not publish anything.',
   'moments-yours', '/moments', null, '{}'::text[], null, null),
  ('moments-guide', 3, 'share', 'Share a Moment',
   'Open the composer to choose a photo or video, caption, audience, and expiry.',
   'moments-share', '/moments', null, '{}'::text[], null, null),
  ('moments-guide', 4, 'audience', 'Choose who sees it',
   'Share with your Muddies or a narrower audience available in the composer.',
   null, '/moments', null, '{}'::text[], null, null),
  ('moments-guide', 5, 'expiry', 'Temporary by design',
   'Choose an expiry before publishing. The walkthrough never posts for you.',
   null, '/moments', null, '{}'::text[], null, null),
  ('moments-guide', 6, 'reactions', 'React to a Moment',
   'Use a quick reaction on a real Moment when one is available.',
   'moments-reactions', '/moments', null, '{}'::text[], null, null),

  -- Air (5, entirely behind the managed flag)
  ('air-guide', 1, 'air', 'Welcome to Air',
   'Air is the wider Mad Buddy surface for discovering public Moments.',
   'moments-air-tab', '/moments', 'open_moments', '{}'::text[], null, null),
  ('air-guide', 2, 'on-air', 'ON AIR',
   'ON AIR marks a public Moment that is currently available to discover.',
   'moments-feed', '/moments', 'open_moments', '{}'::text[], null, null),
  ('air-guide', 3, 'tune-in', 'Tune In',
   'Tune In privately to find a creator and their current Moments again.',
   'moments-tune-in', '/moments', 'open_moments', '{}'::text[], null, null),
  ('air-guide', 4, 'react', 'React on Air',
   'Reactions support a Moment without creating follower or subscription lists.',
   'moments-reactions', '/moments', 'open_moments', '{}'::text[], null, null),
  ('air-guide', 5, 'publish', 'Publishing access',
   'Publishing to Air follows the current plan entitlement. Viewing never pretends to grant publishing access.',
   'moments-share', '/moments', 'open_moments', '{public_moments}'::text[], 'See plan options', '/billing'),

  -- Social Plans (5)
  ('plans-guide', 1, 'social-plans', 'Plans with Muddies',
   'Social Plans organise something to do together. They are not subscription tiers.',
   'plans-list', '/plans', null, '{}'::text[], null, null),
  ('plans-guide', 2, 'create', 'Create a plan',
   'Add the activity, broad place label, time, and Muddies you want to invite.',
   'plans-create', '/plans', null, '{}'::text[], null, null),
  ('plans-guide', 3, 'views', 'Track every plan',
   'Use the tabs for upcoming plans, invitations, plans you host, and past plans.',
   'plans-tabs', '/plans', null, '{}'::text[], null, null),
  ('plans-guide', 4, 'participants', 'Plan together',
   'Plan details show participants, polls, and the current responses.',
   'plans-list', '/plans', null, '{}'::text[], null, null),
  ('plans-guide', 5, 'rsvp', 'Respond to an invite',
   'Open an invitation to choose Going, Maybe, or Cannot make it.',
   'plans-rsvp', '/plans', null, '{}'::text[], null, null),

  -- Events (4)
  ('events-guide', 1, 'discover', 'Discover events',
   'Current events and the real empty state appear here.',
   'events-list', '/events', null, '{}'::text[], null, null),
  ('events-guide', 2, 'views', 'Choose a view',
   'Browse upcoming, happening now, and events you host.',
   'events-tabs', '/events', null, '{}'::text[], null, null),
  ('events-guide', 3, 'details', 'View event details',
   'Open an event to see its time, venue label, host, and available actions.',
   'events-actions', '/events', null, '{}'::text[], null, null),
  ('events-guide', 4, 'create', 'Host an event',
   'Create an event when you want to bring Muddies together.',
   'events-create', '/events', null, '{}'::text[], null, null),

  -- Safe Arrival (8)
  ('safe-arrival-guide', 1, 'overview', 'Safe Arrival',
   'Share a journey status with trusted Muddies, without sharing your movement.',
   'safe-arrival-overview', '/safe-arrival', null, '{}'::text[], null, null),
  ('safe-arrival-guide', 2, 'start', 'Start a journey',
   'Open setup when you want trusted Muddies to know you got there safely.',
   'safe-arrival-start', '/safe-arrival', null, '{}'::text[], null, null),
  ('safe-arrival-guide', 3, 'details', 'Add journey details',
   'Enter a destination label, expected arrival, grace period, and optional note.',
   null, '/safe-arrival', null, '{}'::text[], null, null),
  ('safe-arrival-guide', 4, 'contacts', 'Choose trusted Muddies',
   'Only the Muddies you select receive a request to check on this journey.',
   null, '/safe-arrival', null, '{}'::text[], null, null),
  ('safe-arrival-guide', 5, 'accepted-watchers', 'Accepted watchers',
   'Only contacts who accept count as watching. Pending and declined contacts do not.',
   'safe-arrival-watchers', '/safe-arrival', null, '{}'::text[], null, null),
  ('safe-arrival-guide', 6, 'active', 'Journey in progress',
   'The traveller can extend the expected time, confirm arrival, or end Safe Arrival.',
   'safe-arrival-active', '/safe-arrival', null, '{}'::text[], null, null),
  ('safe-arrival-guide', 7, 'watcher-request', 'Watcher request',
   'A selected Muddy can accept or decline. Accepting shows the journey status and expected time.',
   'safe-arrival-watcher-request', '/safe-arrival', null, '{}'::text[], null, null),
  ('safe-arrival-guide', 8, 'alerts', 'Calm safety alerts',
   'Accepted watchers are notified when the traveller arrives or misses confirmation after the grace period.',
   'safe-arrival-overview', '/safe-arrival', null, '{}'::text[], null, null),

  -- Profile (5)
  ('profile-guide', 1, 'overview', 'Your profile',
   'This is how approved Muddies recognise you.',
   'profile-overview', '/profile', null, '{}'::text[], null, null),
  ('profile-guide', 2, 'photo', 'Profile photo',
   'Add or replace the photo shown with your profile.',
   'profile-photo', '/profile', null, '{}'::text[], null, null),
  ('profile-guide', 3, 'edit', 'Edit your identity',
   'Update your display name, username, mood, and short bio.',
   'profile-edit', '/profile', null, '{}'::text[], null, null),
  ('profile-guide', 4, 'about', 'Shared details',
   'Mood and bio help approved Muddies recognise you. You can leave them empty.',
   'profile-about', '/profile', null, '{}'::text[], null, null),
  ('profile-guide', 5, 'privacy', 'Profile privacy',
   'Open Glow controls to review your current visibility state.',
   'profile-privacy', '/profile', null, '{}'::text[], null, null),

  -- Privacy and safety (6)
  ('privacy-safety-guide', 1, 'overview', 'Privacy and safety',
   'These controls decide when you appear and who may contact you.',
   'privacy-overview', '/settings/privacy', null, '{}'::text[], null, null),
  ('privacy-safety-guide', 2, 'glow', 'Glow visibility',
   'Choose your approved audience and how long your Glow stays available.',
   'privacy-glow', '/settings/privacy', null, '{}'::text[], null, null),
  ('privacy-safety-guide', 3, 'messaging', 'Messaging privacy',
   'Review who may message you or add you to group conversations.',
   'privacy-messaging', '/settings/privacy', null, '{}'::text[], null, null),
  ('privacy-safety-guide', 4, 'blocked', 'Blocked accounts',
   'Review blocked accounts without changing anything during the guide.',
   'privacy-blocked', '/settings/privacy', null, '{}'::text[], null, null),
  ('privacy-safety-guide', 5, 'ghost', 'Ghost Mode',
   'Ghost Mode pauses your visibility until you turn it back on.',
   'settings-ghost-mode', '/settings', null, '{}'::text[], null, null),
  ('privacy-safety-guide', 6, 'location', 'Location for Glow',
   'Device permission lets Mad Buddy calculate a general Glow signal. It does not reveal forbidden precision to other users.',
   'settings-location-glow', '/settings', null, '{}'::text[], null, null),

  -- Pulse (3)
  ('pulse-guide', 1, 'overview', 'Your Pulse',
   'Friend requests, nearby alerts, plans, messages, and safety updates arrive here.',
   'pulse-overview', '/notifications', null, '{}'::text[], null, null),
  ('pulse-guide', 2, 'filters', 'Filter updates',
   'Choose the category you want to review.',
   'pulse-filters', '/notifications', null, '{}'::text[], null, null),
  ('pulse-guide', 3, 'updates', 'Act on real updates',
   'Open, mark, or manage real updates. Empty means there is nothing waiting.',
   'pulse-list', '/notifications', null, '{}'::text[], null, null),

  -- Achievements (3)
  ('badges-guide', 1, 'overview', 'Private achievements',
   'Achievements celebrate your own activity. They are not a public ranking.',
   'badges-overview', '/badges', null, '{}'::text[], null, null),
  ('badges-guide', 2, 'views', 'Achievements and recaps',
   'Switch between achievements, connection milestones, and your monthly recap.',
   'badges-tabs', '/badges', null, '{}'::text[], null, null),
  ('badges-guide', 3, 'earned', 'See what you earned',
   'Each item shows its real criteria and whether your account has earned it.',
   'badges-list', '/badges', null, '{}'::text[], null, null),

  -- Buddy Score (3)
  ('buddy-score-guide', 1, 'overview', 'Your Buddy Score',
   'This private summary reflects real Mad Buddy activity and is visible only to you.',
   'buddy-score-overview', '/buddy-score', null, '{}'::text[], null, null),
  ('buddy-score-guide', 2, 'breakdown', 'Understand the score',
   'The breakdown shows which real activity categories contributed points.',
   'buddy-score-breakdown', '/buddy-score', null, '{}'::text[], null, null),
  ('buddy-score-guide', 3, 'not-ranking', 'Not a ranking',
   'Buddy Score does not affect access, discovery, or who can find you.',
   'buddy-score-overview', '/buddy-score', null, '{}'::text[], null, null),

  -- Settings (4)
  ('settings-guide', 1, 'account', 'Account controls',
   'Profile, privacy, sessions, achievements, and Buddy Score live here.',
   'settings-account', '/settings', null, '{}'::text[], null, null),
  ('settings-guide', 2, 'privacy', 'Privacy and safety',
   'Manage Glow, Ghost Mode, location permission, blocks, and safety tools.',
   'settings-privacy', '/settings', null, '{}'::text[], null, null),
  ('settings-guide', 3, 'notifications', 'Notification choices',
   'Choose nearby alerts, focus controls, reminders, and messaging preferences.',
   'settings-notifications', '/settings', null, '{}'::text[], null, null),
  ('settings-guide', 4, 'support', 'Help and guides',
   'Open help, replay Feature Guides, send feedback, or invite someone.',
   'settings-support', '/settings', null, '{}'::text[], null, null),

  -- Subscription (4). Values are resolved from the canonical entitlement
  -- registry and price source by TourRunner, never copied into this seed.
  ('subscription-guide', 1, 'overview', 'Plan and billing',
   'See your current subscription and provider status.',
   'billing-overview', '/billing', null, '{}'::text[], null, null),
  ('subscription-guide', 2, 'tiers', 'Compare current tiers',
   'Free, Buddy Plus, and Buddy Pro use the canonical prices and limits shown here.',
   'billing-plans', '/billing', null, '{max_muddies,custom_glow_styles,public_moments}'::text[], null, null),
  ('subscription-guide', 3, 'entitlements', 'Access stays authoritative',
   'Premium controls unlock only when the server confirms the matching entitlement.',
   'billing-plans', '/billing', null, '{}'::text[], null, null),
  ('subscription-guide', 4, 'activity', 'Billing activity',
   'Real subscription changes and Paystack sync status appear here.',
   'billing-activity', '/billing', null, '{}'::text[], null, null)
)
insert into public.tour_steps (
  tour_version_id, position, step_key, title, body, target_id, route,
  requires_feature_flag, entitlement_keys, cta_label, cta_href
)
select
  v.id, s.position, s.step_key, s.title, s.body, s.target_id, s.route,
  s.requires_feature_flag, s.entitlement_keys, s.cta_label, s.cta_href
from seeded_steps s
join public.tours t on t.slug = s.tour_slug
join public.tour_versions v on v.tour_id = t.id and v.version = 1
on conflict (tour_version_id, step_key) do nothing;

-- Progress transitions are monotonic. A late in-flight "started" request from
-- an earlier step must never reopen a version after completion, skip, or
-- dismissal. The existing service-role action is the sole caller.
create or replace function public.record_user_tour_progress(
  p_user_id uuid,
  p_tour_version_id uuid,
  p_status text,
  p_current_step_key text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  final_status text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role required';
  end if;

  if p_status not in ('started', 'completed', 'skipped', 'dismissed') then
    raise exception 'invalid tour progress status';
  end if;

  insert into public.user_tour_progress as current_progress (
    user_id,
    tour_version_id,
    status,
    current_step_key,
    completed_at,
    updated_at
  ) values (
    p_user_id,
    p_tour_version_id,
    p_status,
    p_current_step_key,
    case when p_status = 'completed' then now() else null end,
    now()
  )
  on conflict (user_id, tour_version_id) do update
  set
    status = excluded.status,
    current_step_key = excluded.current_step_key,
    completed_at = case when excluded.status = 'completed' then now() else null end,
    updated_at = now()
  where current_progress.status = 'started'
  returning status into final_status;

  if final_status is null then
    select progress.status
    into final_status
    from public.user_tour_progress progress
    where progress.user_id = p_user_id
      and progress.tour_version_id = p_tour_version_id;
  end if;

  return final_status;
end;
$$;

revoke all on function public.record_user_tour_progress(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.record_user_tour_progress(uuid, uuid, text, text) to service_role;
