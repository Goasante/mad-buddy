-- Canonical Plan Cover system.
--
-- Two additive, nullable columns. Both are optional by design: a plan created
-- without either still renders (the resolver falls back to a branded
-- illustration), so no existing row needs backfilling and no creation flow is
-- forced to collect them.
--
--   category         what the plan IS (beach, dinner, gaming…). Distinct from
--                    the existing plan_type, which is how the plan is
--                    SCHEDULED (quick / scheduled / poll) and says nothing
--                    about its subject.
--
--   cover_image_url  a user-uploaded cover, which outranks the canonical
--                    illustration. Nullable and unset until plan cover uploads
--                    ship; the column exists now so the resolver's priority
--                    chain has a real field to read rather than a stub.
alter table public.plans
  add column if not exists category text,
  add column if not exists cover_image_url text;

-- Check-constrained rather than free text: the cover registry keys off these
-- values, so an unknown category would silently resolve to the fallback with
-- no way to notice. Adding a new category is a one-line constraint change
-- plus a registry entry — no UI change.
alter table public.plans
  drop constraint if exists plans_category_check;

alter table public.plans
  add constraint plans_category_check check (
    category is null or category in (
      'beach', 'dinner', 'coffee', 'study', 'movie', 'football', 'gaming',
      'concert', 'birthday', 'travel', 'workout', 'party', 'picnic',
      'hiking', 'road_trip'
    )
  );

-- Length-bounded so a malformed value cannot bloat the row. Not a storage
-- foreign key: the column may later hold either a Storage object path or a
-- signed URL, and a plan whose cover is deleted must degrade to the canonical
-- illustration rather than break the row.
alter table public.plans
  drop constraint if exists plans_cover_image_url_check;

alter table public.plans
  add constraint plans_cover_image_url_check check (
    cover_image_url is null or char_length(cover_image_url) between 1 and 2048
  );
