-- Consumer walkthrough copy polish.
--
-- UPDATEs the existing main-app-tour v1 steps in place. Nothing is recreated
-- and no step is added or removed, so step ids stay stable and the analytics
-- already recorded against them (per-step drop-off) remain comparable.
--
-- Copy rules applied: one idea per step, no em dashes anywhere, product value
-- before ceremony, privacy stated plainly rather than technically, and no plan
-- capability asserted in prose (the subscription step renders real entitlement
-- values from the canonical catalogue instead).
--
-- Step count is unchanged at 13. Reviewed for consolidation: steps 1 and 2 both
-- concern nearby presence but teach different things (that proximity exists at
-- all, versus how to read glow strength), and step 3 is the privacy promise that
-- makes step 2 acceptable, so all three are kept. Nothing else repeated.

update public.tour_steps s
set title = v.title, body = v.body
from (values
  -- Was a second welcome message; now leads with what the product does for you.
  ('welcome',
   'See who''s around',
   'Mad Buddy lets you know when approved Muddies are nearby without sharing anyone''s exact location.'),

  ('nearby-glow',
   'Nearby Muddies',
   'Muddies who are nearby appear here. A stronger glow means they''re closer.'),

  ('privacy',
   'Your location stays yours',
   'Mad Buddy uses approximate proximity, never your exact location, route, or speed. Only approved Muddies can see your glow.'),

  -- Was two sentences saying the same thing about mutual approval.
  ('muddies',
   'Your Muddies',
   'Muddies are friends you have both approved. Proximity only ever works both ways.'),

  ('hangout',
   'Hangout Mode',
   'Free right now? Turn on Hangout Mode to let your Muddies know what you''re up for.'),

  ('socialize',
   'Socialize',
   'Opt in for a short window to find other people nearby who are also open to connecting. It switches off on its own.'),

  ('safe-arrival',
   'Safe Arrival',
   'Ask trusted Muddies to check you got there. They see where you''re headed and when, never your live location.'),

  ('messages',
   'Messages',
   'Chat one to one, or in a group that comes with a plan.'),

  ('plans',
   'Plans',
   'Make something happen. Invite Muddies and keep the details in one place.'),

  ('pulse',
   'Pulse',
   'Requests, plan updates, and nearby alerts all land here, grouped so nothing gets lost.'),

  ('personalization',
   'Make it yours',
   'Pick a wallpaper to change how the whole app feels.'),

  -- Headline and supporting copy for the redesigned subscription step. The real
  -- per-plan numbers are rendered by the tour from canonical entitlement data,
  -- so this body never states a limit itself.
  ('plans-and-pricing',
   'Make Mad Buddy yours',
   'Free gives you everything you need to get started. Plus and Pro unlock more ways to connect, personalize your experience, and get more from your Muddies.'),

  ('ready',
   'You''re ready',
   'You now know the basics. Find your Muddies, make plans, and use Mad Buddy your way.')
) as v(step_key, title, body)
where s.step_key = v.step_key
  and s.tour_version_id in (
    select tv.id
    from public.tour_versions tv
    join public.tours t on t.id = tv.tour_id
    where t.slug = 'main-app-tour' and tv.version = 1
  );

-- The final step's CTA reads as an invitation to use the app rather than a
-- generic dismissal.
update public.tour_steps s
set cta_label = null, cta_href = null
where s.step_key = 'ready'
  and s.tour_version_id in (
    select tv.id from public.tour_versions tv
    join public.tours t on t.id = tv.tour_id
    where t.slug = 'main-app-tour' and tv.version = 1
  );

-- Invitation copy lives on the tour, not a step.
update public.tours
set
  title = 'Welcome to Mad Buddy',
  description = 'Take a quick tour of how to find nearby Muddies, connect, make plans, and stay in control of your privacy.'
where slug = 'main-app-tour';
