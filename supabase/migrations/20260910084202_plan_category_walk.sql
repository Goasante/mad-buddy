-- Add "walk" to the Plan category constraint.
--
-- "walk" already exists as a HangoutActivityType (UpFor uses it today) but
-- had never carried a Plan category or approved photography of its own. It
-- also stood in for `beach` in the UpFor artwork resolver as a placeholder.
-- Widening the check constraint so a walk plan can carry `category = 'walk'`
-- and pick up its own canonical cover from lib/plans/plan-covers.ts, the same
-- way every other category does.
alter table public.plans
  drop constraint if exists plans_category_check;

alter table public.plans
  add constraint plans_category_check check (
    category is null or category in (
      'beach', 'dinner', 'coffee', 'study', 'movie', 'football', 'gaming',
      'concert', 'birthday', 'travel', 'workout', 'party', 'picnic',
      'hiking', 'road_trip', 'walk'
    )
  );
