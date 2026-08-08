-- Trusted voice-note metadata belongs to the canonical media asset so later
-- message sends never need to parse stored audio again. This migration is
-- additive and intentionally does not enable voice-message sending.

alter table public.media_assets
  add column if not exists intended_media_kind text,
  add column if not exists duration_ms integer,
  add column if not exists waveform_data jsonb;

alter table public.media_assets
  drop constraint if exists media_assets_intended_media_kind_check;
alter table public.media_assets
  add constraint media_assets_intended_media_kind_check check (
    intended_media_kind is null or intended_media_kind in ('image', 'voice_note')
  );

alter table public.media_assets
  drop constraint if exists media_assets_duration_ms_check;
alter table public.media_assets
  add constraint media_assets_duration_ms_check check (
    duration_ms is null or duration_ms between 1 and 300000
  );

alter table public.media_assets
  drop constraint if exists media_assets_waveform_data_check;
alter table public.media_assets
  add constraint media_assets_waveform_data_check check (
    waveform_data is null
    or (jsonb_typeof(waveform_data) = 'array' and jsonb_array_length(waveform_data) between 1 and 64)
  );

comment on column public.media_assets.intended_media_kind is
  'Server-selected chat upload kind. Prevents an image intent being finalized as voice, or vice versa.';
comment on column public.media_assets.duration_ms is
  'Trusted duration derived by server-side container parsing. Client timers are never stored here.';
comment on column public.media_assets.waveform_data is
  'Optional validated 0-100 presentation envelope. Never used for authorization or duration.';
