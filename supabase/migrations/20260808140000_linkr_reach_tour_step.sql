-- Linkr: re-point and reword the walkthrough's "controls" step.
--
-- Activation collapsed into a single Discover Nearby play/pause control, so
-- the popover that carried area AND duration no longer exists. Two problems
-- follow, and this migration fixes both:
--
--   1. `socialize-controls` targets an element that is never rendered. A tour
--      step pointing at nothing silently highlights nothing.
--
--   2. The copy described a choice the product no longer asks for. Duration is
--      now a default with an explicit pause, not a question answered before
--      the user has seen anyone.
--
-- Re-pointed at `socialize-reach`, the segmented How-far control, because that
-- IS the surviving control this step was about: who can see you. The step is
-- kept rather than deleted — reach is still worth explaining, and it is the
-- one activation decision that remains the user's.
--
-- The expiry sentence stays. Sessions still lapse, and that is exactly the
-- kind of thing a walkthrough should say out loud rather than leave for a user
-- to discover while still visible an hour later.
--
-- Scoped through tour_versions -> tours, matching 20260807200000: tour_steps
-- has no slug of its own.
--
-- NOT an edit to 20260801120000_feature_walkthroughs.sql: that migration has
-- already been applied, and rewriting applied history would leave any database
-- that ran it disagreeing with any that runs it later.
--
-- Rollback: restore target_id to socialize-controls, the title to
-- "Choose the window", and the original body, for the socialize-guide step
-- whose step_key is "controls".

update public.tour_steps as step
set
  target_id = 'socialize-reach',
  title = 'Choose how far',
  body = 'Pick how far you want to be discoverable. Your session ends on its own, and you can pause any time.'
where step.step_key = 'controls'
  and exists (
    select 1
    from public.tour_versions as version
    join public.tours as tour on tour.id = version.tour_id
    where version.id = step.tour_version_id
      and tour.slug = 'socialize-guide'
  );

-- Verification: no Linkr step may point at a control that no longer renders.
do $$
declare
  stale_count integer;
begin
  select count(*) into stale_count
  from public.tour_steps as step
  join public.tour_versions as version on version.id = step.tour_version_id
  join public.tours as tour on tour.id = version.tour_id
  where tour.slug = 'socialize-guide'
    and step.target_id = 'socialize-controls';

  if stale_count > 0 then
    raise warning 'linkr_reach_tour_step: % step(s) still target socialize-controls; they were edited after the original seed and need a manual pass.', stale_count;
  end if;
end;
$$;
