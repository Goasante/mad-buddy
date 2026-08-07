-- Linkr rename — guided-tour copy only.
--
-- The Socialize surface is now called Linkr in the UI. Three seeded
-- walkthrough strings still say "Socialize", so a user who opens the tour is
-- told to find a page whose name no longer appears anywhere on screen.
--
-- COPY ONLY, deliberately. Untouched:
--   * the `socialize-guide` slug          — an identifier; renaming it would
--                                           orphan every user's saved progress
--   * `entry_route` (/discover)           — a real route
--   * `target_id` (socialize-feed etc.)   — bound to data-tour-id in the app
--   * step keys, ordering, flags, entitlements — no behavioural change
--
-- NOT an edit to 20260801120000_feature_walkthroughs.sql: that migration has
-- already been applied, and rewriting applied history would leave a database
-- that ran it disagreeing with one that runs it later.
--
-- Matching on the exact previous strings rather than a blanket replace, so
-- re-running this is a no-op and any copy edited by hand since is left alone.
--
-- Rollback: swap the two arguments of each replace() below.

update public.tours
set
  title = 'Linkr guide',
  description = 'Opt in to meet other people who are open to connecting.'
where slug = 'socialize-guide'
  and title = 'Socialize guide';

update public.tour_steps as step
set title = 'Opt in to Linkr'
where step.title = 'Opt in to Socialize'
  and exists (
    select 1
    from public.tour_versions as version
    join public.tours as tour on tour.id = version.tour_id
    where version.id = step.tour_version_id
      and tour.slug = 'socialize-guide'
  );

update public.tour_steps as step
set body = 'Wave or send a Muddy request. Linkr never grants friend-level access by itself.'
where step.body = 'Wave or send a Muddy request. Socialize never grants friend-level access by itself.'
  and exists (
    select 1
    from public.tour_versions as version
    join public.tours as tour on tour.id = version.tour_id
    where version.id = step.tour_version_id
      and tour.slug = 'socialize-guide'
  );

-- Verification: no user-facing tour copy should mention the old name.
do $$
declare
  stale_count integer;
begin
  select count(*) into stale_count
  from public.tour_steps as step
  join public.tour_versions as version on version.id = step.tour_version_id
  join public.tours as tour on tour.id = version.tour_id
  where tour.slug = 'socialize-guide'
    and (step.title ilike '%socializ%' or step.body ilike '%socializ%');

  if stale_count > 0 then
    raise warning 'linkr_tour_copy: % step(s) still mention the old name; they were edited after the original seed and need a manual pass.', stale_count;
  end if;
end;
$$;
