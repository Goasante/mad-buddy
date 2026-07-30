-- Moments: the "All Muddies" audience.
--
-- The audience model had close_friends, selected_muddies, selected_circles,
-- nearby_muddies, event_circle, plan and public — but no way to say "every
-- approved Muddy". The closest options each mean something narrower:
-- close_friends is a subset, and nearby_muddies additionally requires a fresh
-- in-band presence, so a Moment posted to it is invisible to a Muddy who is not
-- physically near. Encoding "all Muddies" as selected_muddies with every id
-- listed would also go stale the moment a new Muddy is added.
--
-- Additive: the check constraint gains one value. Every existing row keeps its
-- current audience, and no row is rewritten.
--
-- Rollback (only safe once no row uses it):
--   alter table public.moments drop constraint moments_audience_type_check;
--   alter table public.moments add constraint moments_audience_type_check check (
--     audience_type in ('close_friends','selected_muddies','selected_circles',
--                       'nearby_muddies','event_circle','plan','public'));

alter table public.moments
  drop constraint if exists moments_audience_type_check;

alter table public.moments
  add constraint moments_audience_type_check check (
    audience_type in (
      'all_muddies',
      'close_friends',
      'selected_muddies',
      'selected_circles',
      'nearby_muddies',
      'event_circle',
      'plan',
      'public'
    )
  );

-- The existing "muddies read active moments" RLS policy already scopes private
-- reads to approved, unblocked Muddies, which is exactly the floor this audience
-- needs, so no policy change is required. Audience narrowing above that floor
-- stays in the application service, as before.
