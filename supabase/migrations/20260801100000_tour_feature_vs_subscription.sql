-- Walkthrough fix: features are features, subscription plans are plans.
--
-- THE BUG
-- Steps 5 (hangout) and 9 (plans) each carried entitlement_keys
-- (max_active_hangouts, max_plan_participants). The runner renders its
-- three-column Free/Plus/Pro comparison for ANY step with entitlement keys, so
-- two ordinary feature steps turned into subscription tables. On the Plans step
-- that reads as if the Mad Buddy "Plans" FEATURE and a subscription "plan" are
-- the same thing, which is the most confusing possible framing.
--
-- Fixed by clearing entitlement_keys from every feature step, so the plan
-- comparison exists in exactly ONE place: the dedicated subscription step.
--
-- Also reorders the sequence so Moments (now a major feature) appears at step 4,
-- and adds a Moments step targeting nav-moments, which is a real registered
-- data-tour-id derived from the /moments nav route.
--
-- UPDATEs in place wherever a step_key already exists, so step ids and the
-- per-step drop-off analytics recorded against them stay comparable. Only the
-- genuinely new Moments step is inserted, and nothing is deleted.
--
-- Copy rules: no em dashes, one idea per step, and subscription tiers are
-- explained once rather than mentioned repeatedly.

-- ---------------------------------------------------------------------------
-- 1. Feature steps must not render a plan comparison.
-- ---------------------------------------------------------------------------

update public.tour_steps s
set entitlement_keys = '{}'
where s.step_key <> 'plans-and-pricing'
  and s.entitlement_keys is not null
  and array_length(s.entitlement_keys, 1) > 0
  and s.tour_version_id in (
    select tv.id
    from public.tour_versions tv
    join public.tours t on t.id = tv.tour_id
    where t.slug = 'main-app-tour'
  );

-- ---------------------------------------------------------------------------
-- 2. The new Moments step.
-- ---------------------------------------------------------------------------
-- Inserted at a temporary high position; the reorder below assigns the real one.
-- ON CONFLICT keeps this migration idempotent if it is ever re-run.

insert into public.tour_steps (
  tour_version_id, position, step_key, title, body, target_id, route, entitlement_keys
)
select
  tv.id,
  900,
  'moments',
  'Share what matters now',
  'Post a photo that disappears, choose exactly who sees it, or explore Spotlight to discover people across Mad Buddy.',
  'nav-moments',
  '/moments',
  '{}'
from public.tour_versions tv
join public.tours t on t.id = tv.tour_id
where t.slug = 'main-app-tour'
  and not exists (
    select 1 from public.tour_steps existing
    where existing.tour_version_id = tv.id and existing.step_key = 'moments'
  );

-- ---------------------------------------------------------------------------
-- 3. Copy, audited across all steps.
-- ---------------------------------------------------------------------------

update public.tour_steps s
set title = v.title, body = v.body
from (values
  ('welcome',
   'See who''s around',
   'Mad Buddy shows you when approved Muddies are nearby, without sharing anyone''s exact location.'),

  ('nearby-glow',
   'Nearby Muddies',
   'Muddies who are close by show up here. A stronger glow means they''re nearer.'),

  ('privacy',
   'Your location stays yours',
   'Mad Buddy uses approximate proximity, never your exact location, route, or speed. Only approved Muddies can see your glow.'),

  -- Moments moves early: it is one of the main reasons to open the app.
  ('moments',
   'Share what matters now',
   'Post a photo that disappears, choose exactly who sees it, or explore Spotlight to discover people across Mad Buddy.'),

  ('socialize',
   'Socialize',
   'Open up for a short window to meet people nearby who are also up for connecting. It switches off on its own.'),

  -- Was a Free/Plus/Pro table. Now explains what Hangout Mode actually is.
  ('hangout',
   'Free right now?',
   'Turn on Hangout Mode when you''re up for something. Food, gym, a walk, gaming, or just chilling. You pick how long you''re free and who can see it.'),

  ('messages',
   'Messages',
   'Chat one to one, or in a group that comes with a plan.'),

  ('safe-arrival',
   'Safe Arrival',
   'Ask a few Muddies to check you got there. They see where you''re headed and when, never your live location.'),

  -- Was also a subscription table, which made the Plans FEATURE look like a
  -- pricing tier. Now it is about organising something to do.
  ('plans',
   'Turn an idea into a plan',
   'Create something to do, invite your Muddies, pick a time, and keep everyone on the same page.'),

  ('pulse',
   'Pulse',
   'Requests, plan updates, and nearby alerts land here, grouped so nothing gets lost.'),

  ('muddies',
   'Your Muddies',
   'Muddies are friends you have both approved. Proximity only ever works both ways.'),

  -- The ONE place tiers are explained. The runner renders the real per-plan
  -- figures from canonical entitlement data beneath this copy.
  ('plans-and-pricing',
   'Choose your Mad Buddy',
   'Free covers everything you need to start. Buddy Plus gives you more room to connect, and Buddy Pro adds the highest limits plus publishing to Spotlight.'),

  ('ready',
   'You''re ready',
   'That''s the tour. Find your Muddies, share a Moment, and make something happen.')
) as v(step_key, title, body)
where s.step_key = v.step_key
  and s.tour_version_id in (
    select tv.id
    from public.tour_versions tv
    join public.tours t on t.id = tv.tour_id
    where t.slug = 'main-app-tour'
  );

-- ---------------------------------------------------------------------------
-- 4. The subscription step gets the entitlements worth comparing.
-- ---------------------------------------------------------------------------
-- Chosen because each one genuinely DIFFERS across tiers and is understandable
-- without product knowledge. public_moments is the Spotlight publishing
-- capability and is what makes Buddy Pro's headline benefit visible.
--
-- Values are never written here: the runner resolves them server-side from the
-- canonical registry, so this list only says WHICH rows to show.

update public.tour_steps s
set entitlement_keys = array[
      'max_muddies',
      'max_close_friends',
      'max_daily_moments',
      'public_moments'
    ]::text[]
where s.step_key = 'plans-and-pricing'
  and s.tour_version_id in (
    select tv.id
    from public.tour_versions tv
    join public.tours t on t.id = tv.tour_id
    where t.slug = 'main-app-tour'
  );

-- ---------------------------------------------------------------------------
-- 5. Retire the wallpaper step (must happen BEFORE the reorder).
-- ---------------------------------------------------------------------------
-- The personalization step (wallpaper) leaves the sequence so the tour stays at
-- 13 steps with Moments added: a wallpaper picker is discoverable on its own and
-- did not earn a slot ahead of Moments.
--
-- Retired through the EXISTING conditional-step mechanism rather than deleted.
-- `isStepEligible` (lib/tours/model.ts) hides any step whose
-- requires_feature_flag is not in the subject's enabled flags, and no flag with
-- this key exists, so it is filtered out for every user. The row, its id and its
-- historical per-step analytics all survive, and an admin can restore it by
-- clearing the flag in the authoring UI.
update public.tour_steps s
set requires_feature_flag = 'tour_step_retired', position = 99
where s.step_key = 'personalization'
  and s.tour_version_id in (
    select tv.id
    from public.tour_versions tv
    join public.tours t on t.id = tv.tour_id
    where t.slug = 'main-app-tour'
  );

-- ---------------------------------------------------------------------------
-- 6. Reorder into the story sequence.
-- ---------------------------------------------------------------------------
-- Two passes with an offset, because `position` is unique per version: writing
-- the final numbers directly would collide with rows that still hold them.

update public.tour_steps s
set position = v.position + 1000
from (values
  ('welcome', 1),
  ('nearby-glow', 2),
  ('privacy', 3),
  ('moments', 4),
  ('socialize', 5),
  ('hangout', 6),
  ('messages', 7),
  ('safe-arrival', 8),
  ('plans', 9),
  ('pulse', 10),
  ('muddies', 11),
  ('plans-and-pricing', 12),
  ('ready', 13)
) as v(step_key, position)
where s.step_key = v.step_key
  and s.tour_version_id in (
    select tv.id
    from public.tour_versions tv
    join public.tours t on t.id = tv.tour_id
    where t.slug = 'main-app-tour'
  );

update public.tour_steps s
set position = s.position - 1000
where s.position > 1000
  and s.tour_version_id in (
    select tv.id
    from public.tour_versions tv
    join public.tours t on t.id = tv.tour_id
    where t.slug = 'main-app-tour'
  );

