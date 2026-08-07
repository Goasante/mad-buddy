-- Socialize 2.0: re-point the Socialize walkthrough at the discovery feed.
--
-- The radar was replaced by a vertical discovery feed, so the `socialize-radar`
-- tour target no longer exists in the UI. Two seeded walkthrough steps still
-- reference it, and a step pointing at an element that never renders is a tour
-- that silently highlights nothing.
--
-- The steps themselves are still correct — they describe discovering nearby
-- people, which is exactly what the feed does — so this re-points them rather
-- than deleting the walkthrough.
--
-- NOT an edit to 20260801120000_feature_walkthroughs.sql: that migration has
-- already been applied, and rewriting applied history would leave any database
-- that ran it disagreeing with any that runs it later.
--
-- Rollback:
--   update public.tour_steps set target_id = 'socialize-radar'
--   where target_id = 'socialize-feed';

update public.tour_steps
set target_id = 'socialize-feed'
where target_id = 'socialize-radar';
