-- Make profile photo slots reorderable.
--
-- Moving a photo from slot 0 to slot 1 means two rows swap positions, and two
-- direct updates collide on the unique (user_id, position) constraint
-- whichever order they run in.
--
-- The swap parks the moving row at -1, steps the displaced row into the
-- vacated slot, then lands the mover. That needs -1 to be a legal position,
-- so the range check widens by exactly one value.
--
-- WHY -1 RATHER THAN DROPPING THE CHECK: the check is what caps the gallery
-- at three photos. Widening it to a single impossible-for-real-photos value
-- keeps that cap intact while giving the swap somewhere to stand. A row left
-- at -1 by an interrupted swap is visibly wrong rather than silently
-- plausible, and it renders nowhere because every read orders by position and
-- the carousel only draws slots 0..2.
--
-- Rollback:
--   delete from public.profile_photos where position < 0;
--   alter table public.profile_photos drop constraint profile_photos_position_check;
--   alter table public.profile_photos add constraint profile_photos_position_check
--     check (position between 0 and 2);

alter table public.profile_photos
  drop constraint if exists profile_photos_position_check;

alter table public.profile_photos
  add constraint profile_photos_position_check
    check (position between -1 and 2);

comment on column public.profile_photos.position is
  'Carousel slot, 0..2. -1 is a transient parking value used only mid-swap by the reorder action; no photo is ever left there, and nothing renders it.';
