-- Short-video support for private and Open Moments.
-- Videos reuse the existing private media bucket, signed reads, moderation,
-- parent expiry, and queued physical deletion. No location column is added.

alter table public.media_assets
  drop constraint if exists media_assets_content_type_check;

alter table public.media_assets
  add constraint media_assets_content_type_check check (
    content_type in (
      'image/jpeg',
      'image/png',
      'image/webp',
      'audio/webm',
      'audio/mpeg',
      'audio/mp4',
      'audio/ogg',
      'video/mp4',
      'video/webm',
      'video/quicktime'
    )
  );

alter table public.moments
  drop constraint if exists moments_content_type_check;

alter table public.moments
  add constraint moments_content_type_check check (
    content_type in ('text', 'photo', 'video')
  );

alter table public.moments
  drop constraint if exists moments_has_content;

alter table public.moments
  add constraint moments_has_content check (
    (content_type = 'text' and text_content is not null)
    or (content_type in ('photo', 'video') and media_id is not null)
  );

-- Keep Storage as a second size/type boundary. The app has stricter
-- context-specific caps (Moment videos are 5 MB), while chat/drop media may be
-- larger under their existing server rules.
update storage.buckets
set
  file_size_limit = 15728640,
  allowed_mime_types = array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'audio/webm',
    'audio/mpeg',
    'audio/mp4',
    'audio/ogg',
    'video/mp4',
    'video/webm',
    'video/quicktime'
  ]::text[]
where id = 'media';
