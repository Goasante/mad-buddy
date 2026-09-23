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
