-- PROPOSED, NOT YET APPROVED FOR APPLICATION (Stage F, Part A).
--
-- Event cover artwork, stored through the CANONICAL media stack rather than a
-- second one. Audited first: public.media_assets already exists, already lists
-- 'event' in its context_type check, already carries processing_status,
-- moderation_status, retention_policy and deleted_at, and already has an
-- orphan-collection path. There was no reason to invent a parallel table or a
-- bare URL column, and doing so would have meant event artwork silently opting
-- out of moderation and retention.
--
-- WHAT WAS MISSING was only the pointer: public.events had no way to name its
-- cover. Columns are:
--
--   cover_media_id  -- FK into media_assets. NULL is legitimate and permanent
--                      for legacy events (see below) and for drafts.
--   cover_focal_x   -- 0..1 horizontal focal point, default centre.
--   cover_focal_y   -- 0..1 vertical focal point, default centre.
--
-- WHY A FOCAL POINT RATHER THAN STORED CROPS. One uploaded image feeds a tall
-- accordion panel, a small square list thumbnail and a wide detail header.
-- Storing three crops would triple the storage and still be wrong the moment a
-- fourth surface appears. A focal point is two numbers that every surface can
-- crop around, so the subject stays in frame everywhere.
--
-- ON DELETE SET NULL, deliberately. If a cover asset is ever removed -- by
-- moderation, by retention, by the owner deleting it -- the EVENT must survive
-- and fall back to its deterministic generated artwork. ON DELETE CASCADE here
-- would let removing an image delete the event, which is catastrophic and
-- completely disproportionate.
--
-- NO NOT NULL CONSTRAINT, deliberately. The product rule is "a PUBLISHED event
-- must have a cover". That is a rule about a transition, not about every row:
--   - drafts legitimately have no cover yet
--   - legacy events created before this rule keep NULL forever and must remain
--     viewable (they render the existing deterministic fallback)
-- A NOT NULL column would have required back-filling fake artwork onto historic
-- rows, which is exactly the "do not force-edit historical records" the brief
-- rules out. The publish rule is enforced in the publish path (server-side,
-- not only in the UI) where it can see the transition and explain itself.
--
-- NOT a data migration: no existing row changes. Every current event keeps
-- cover_media_id NULL and renders exactly as it does today.
--
-- Rollback:
--   alter table public.events
--     drop column if exists cover_media_id,
--     drop column if exists cover_focal_x,
--     drop column if exists cover_focal_y;

alter table public.events
  add column if not exists cover_media_id uuid
    references public.media_assets(id) on delete set null,
  add column if not exists cover_focal_x real not null default 0.5
    check (cover_focal_x >= 0 and cover_focal_x <= 1),
  add column if not exists cover_focal_y real not null default 0.5
    check (cover_focal_y >= 0 and cover_focal_y <= 1);

comment on column public.events.cover_media_id is
  'Cover artwork, via the canonical media_assets stack. NULL for drafts and for legacy events predating the published-cover rule; those render the deterministic generated fallback. Never NOT NULL: the requirement applies to the publish transition, not to every row.';

comment on column public.events.cover_focal_x is
  'Horizontal focal point 0..1 (0.5 = centre). One uploaded image is cropped around this for the portrait accordion, the square list thumbnail and the wide detail header.';

comment on column public.events.cover_focal_y is
  'Vertical focal point 0..1 (0.5 = centre). See cover_focal_x.';

-- Lets the orphan/cleanup path find events still pointing at an asset without
-- scanning the table. Partial: the overwhelming majority of rows are NULL.
create index if not exists events_cover_media_idx
  on public.events(cover_media_id)
  where cover_media_id is not null;
