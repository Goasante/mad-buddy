-- Group images.
--
-- `group_settings.image_media_id` has existed since the messaging schema but
-- nothing has ever populated it: every group renders as an initials tile, on
-- Linkr and everywhere else. The column was right; the pipeline to fill it
-- was missing.
--
-- Two changes, both narrow.

-- ---------------------------------------------------------------------------
-- 1. `group` becomes a media context.
-- ---------------------------------------------------------------------------
-- `media_assets.context_type` drives retention, storage keys, size limits and
-- the deletion sweep. A group image is none of the existing kinds:
--
--   'profile' would put group art under a person's avatar rules, so deleting
--             an account could reason about a group's image.
--   'chat'    is per-message attachment retention, tied to a message row that
--             a group image does not have.
--   'moment'  expires in 24 hours, which is the opposite of what a group
--             identity needs.
--
-- So it gets its own value rather than borrowing one whose rules do not fit.
-- Reusing a context is how images end up deleted by a policy written for
-- something else entirely.

alter table public.media_assets
  drop constraint if exists media_assets_context_type_check;

alter table public.media_assets
  add constraint media_assets_context_type_check check (
    context_type in ('profile', 'moment', 'drop', 'event', 'plan', 'chat', 'group')
  );

-- ---------------------------------------------------------------------------
-- 2. The image follows its group.
-- ---------------------------------------------------------------------------
-- Retention is `follows_parent`, the existing default: the image exists to
-- identify the group, so it has no reason to outlive it. That is already the
-- column default, so no data change is needed — this comment records the
-- decision rather than enacting it.
--
-- `image_media_id` stays NULLABLE. An image is optional: requiring one would
-- put a file picker between a user and creating a group, and the initials
-- tile remains a perfectly good fallback for a private group nobody browses.

comment on column public.group_settings.image_media_id is
  'Optional group image, used as the group avatar and as its card art on Linkr. Retention follows the group: media_assets.retention_policy = follows_parent.';

-- Discovery reads image_media_id for every public group it lists, so the
-- lookup back to media_assets is on the hot path for that rail.
create index if not exists group_settings_image_idx
  on public.group_settings(image_media_id)
  where image_media_id is not null;

-- ---------------------------------------------------------------------------
-- Rollback
-- ---------------------------------------------------------------------------
--   drop index if exists group_settings_image_idx;
--   Restore the previous context_type check, after clearing any 'group' rows:
--     delete from public.media_assets where context_type = 'group';
