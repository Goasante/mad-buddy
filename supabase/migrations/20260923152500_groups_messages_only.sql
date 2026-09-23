-- Groups now belong to the private Messages product.
--
-- Public/open Group discovery was part of the retired pre-Linkr-2.0 model.
-- Keep the existing schema for backwards compatibility, but close every
-- existing Group so no stale row can continue behaving like a public
-- community or open-join surface.

update public.group_settings
set
  visibility = 'private',
  join_mode = 'invite'
where visibility <> 'private'
   or join_mode <> 'invite';

-- Make the retirement authoritative at the database boundary too. Older
-- browser bundles must not be able to restore public/link state by writing the
-- table directly under an owner policy.
alter table public.group_settings
  drop constraint if exists group_settings_private_only;

alter table public.group_settings
  add constraint group_settings_private_only
  check (visibility = 'private');

alter table public.group_settings
  drop constraint if exists group_settings_invite_only;

alter table public.group_settings
  add constraint group_settings_invite_only
  check (join_mode = 'invite');
