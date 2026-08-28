-- Allow the document types Chats V4 already accepts to actually be stored.
--
-- FOUND BY THE V4 ACTION TESTS, not by code review.
--
-- lib/media/chat-v4-rich-upload-service.ts accepts eight document types (PDF,
-- txt, doc, docx, xls, xlsx, ppt, pptx), validates them server-side, and
-- uploads them to the `media` bucket. But that bucket's allowed_mime_types was
-- last set by 20260724190000_moment_video_support.sql to images, audio and
-- video ONLY -- no document type is on it.
--
-- Storage enforces its own allowlist independently of the application, so every
-- document share would have been accepted by the app, passed every server
-- check, and then been refused by Storage with "mime type application/pdf is
-- not supported". Document sharing would have been dead on arrival in
-- production, and only for documents, which is exactly the kind of gap a
-- rendering-level review does not catch.
--
-- The list below is deliberately IDENTICAL to DOCUMENT_MIME_BY_KIND in the
-- upload service plus the existing media types. Storage stays a second
-- boundary rather than a wider one: nothing is permitted here that the
-- application layer does not already validate, and the 15 MB size limit is
-- unchanged.
update storage.buckets
set
  allowed_mime_types = array[
    -- Existing image / audio / video types, preserved exactly.
    'image/jpeg',
    'image/png',
    'image/webp',
    'audio/webm',
    'audio/mpeg',
    'audio/mp4',
    'audio/ogg',
    'video/mp4',
    'video/webm',
    'video/quicktime',
    -- Chats V4 documents, matching the upload service's allowlist.
    'application/pdf',
    'text/plain',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ]::text[]
where id = 'media';
