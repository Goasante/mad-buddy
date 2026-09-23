-- Retire public Group discovery.
--
-- Groups are private messaging conversations now. They live under Messages,
-- not Linkr/discovery, and no signed-in non-member should gain read access to a
-- group_settings row merely because an old visibility value was "public".
--
-- Existing memberships, messages, roles and private invite/link history stay
-- intact. Only the public listing capability is removed.

update public.group_settings
set visibility = 'private',
    updated_at = now()
where visibility = 'public';

drop policy if exists "public groups discoverable"
  on public.group_settings;

drop index if exists public.group_settings_public_discovery_idx;

-- Make the product decision durable at the database boundary too. The column
-- remains for backwards-compatible row shapes, but it can no longer be widened.
alter table public.group_settings
  drop constraint if exists group_settings_visibility_check;

alter table public.group_settings
  drop constraint if exists group_settings_visibility_private_only_check;

alter table public.group_settings
  add constraint group_settings_visibility_private_only_check
  check (visibility = 'private');

comment on column public.group_settings.visibility is
  'Legacy compatibility field. Groups are private messaging conversations; public Group discovery was retired on 2026-09-23.';
