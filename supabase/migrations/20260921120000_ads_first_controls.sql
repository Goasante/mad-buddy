-- Ads-first monetization controls.
--
-- All advertising ships OFF. The owner enables formats deliberately from
-- Admin -> Features after publisher/ad-unit configuration is verified.
-- Missing rows also resolve false in lib/features/feature-flags.ts, so a
-- partial migration or read failure can never turn advertising on by accident.

insert into public.feature_flags (key, description, status, default_value)
values
  (
    'ads_enabled',
    'Master switch for third-party advertising across Mad Buddy.',
    'off',
    false
  ),
  (
    'ads_inline',
    'Responsive advertising inserted only at approved content breaks.',
    'off',
    false
  ),
  (
    'ads_anchor',
    'Google-managed anchor/banner advertising on approved PWA surfaces.',
    'off',
    false
  ),
  (
    'ads_interstitial',
    'Occasional full-screen advertising at approved natural breaks.',
    'off',
    false
  )
on conflict (key) do update
set description = excluded.description;
