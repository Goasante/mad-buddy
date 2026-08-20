-- ---------------------------------------------------------------------------
-- Profile owns identity; Linkr consumes it
--
-- Linkr had grown its own copy of two things Profile already owned: a photo
-- library (`linkr_photos`) and, briefly, a date-of-birth write path. That gave
-- the product two answers to "what does this person look like" and two places
-- that could disagree about how old they are.
--
-- This migration completes the boundary:
--
--   PROFILE  profile picture, showcase photos, date of birth, derived age
--   LINKR    discoverability, intent, preferences, Pass/Connect, Event Mode
--
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. One self-serve date-of-birth correction.
--
-- Onboarding was the ONLY writer and treats the field as optional, so somebody
-- who mistyped their date had no way back -- the product's whole answer was
-- "your date of birth is already set". That is a dead end for an honest
-- mistake.
--
-- Freely editable is the opposite failure: age gates every 18+ surface, so an
-- endlessly editable birthday is an endlessly bypassable gate.
--
-- So the budget is exactly one, and it lives here rather than in application
-- state because a client must not be able to reset it. NULL means the
-- correction is still available; a timestamp means it has been spent.
--
-- Setting a date for the FIRST time does not spend it -- only changing an
-- existing one does.
-- ---------------------------------------------------------------------------
alter table public.profile_birth_details
  add column if not exists correction_used_at timestamptz;

comment on column public.profile_birth_details.correction_used_at is
  'When the single self-serve DOB correction was spent. NULL = still available. Further changes go through support.';

-- ---------------------------------------------------------------------------
-- 2. Retire the duplicated Linkr photo library.
--
-- `linkr_photos` existed for exactly one reason: Linkr collected its own
-- uploads during activation. Every reader of it was a Linkr upload path. Now
-- that Profile owns identity imagery and Linkr reads a projection over
-- `profiles.profile_media_id` + `profile_photos`, the table has no remaining
-- job -- there is no ordering or metadata Linkr needs that Profile does not
-- already hold.
--
-- BACKFILL BEFORE DROP, so nobody loses a picture they uploaded through the
-- old flow. Both steps are additive to Profile and reference the SAME
-- media_assets rows, so no image is copied, re-encoded or re-uploaded.
-- ---------------------------------------------------------------------------

-- 2a. A Linkr primary photo becomes the profile picture, but ONLY for someone
--     who has no profile picture yet. Overwriting an existing avatar would
--     silently change the face the rest of the product shows.
update public.profiles p
   set profile_media_id = lp.media_asset_id,
       updated_at = now()
  from public.linkr_photos lp
 where lp.user_id = p.user_id
   and lp.position = 0
   and p.profile_media_id is null;

-- 2b. Linkr showcase photos (slots 1-3) become Profile showcase photos.
--
--     `everyone` visibility is correct and deliberate: these were uploaded to
--     a stranger-facing surface, so their owner already chose to show them to
--     people who do not know them. Defaulting them to `approved_muddies`
--     would silently remove them from the Linkr card they were added for.
insert into public.profile_photos (user_id, media_asset_id, position, visibility)
select lp.user_id,
       lp.media_asset_id,
       lp.position - 1,          -- Linkr slot 1..3 -> Profile slot 0..2
       'everyone'
  from public.linkr_photos lp
 where lp.position between 1 and 3
   -- Never displace a photo Profile already holds in that slot.
   and not exists (
     select 1 from public.profile_photos pp
      where pp.user_id = lp.user_id and pp.position = lp.position - 1
   )
   -- Nor duplicate an asset Profile already shows somewhere.
   and not exists (
     select 1 from public.profile_photos pp
      where pp.user_id = lp.user_id and pp.media_asset_id = lp.media_asset_id
   )
on conflict do nothing;

-- 2c. The table itself. Dropped only after the two backfills above have moved
--     every referenced asset into Profile. The media_assets rows are
--     untouched, so the images themselves survive regardless.
drop table if exists public.linkr_photos;
