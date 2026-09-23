-- Launch the factual Friendship Milestones capability.
--
-- Other Life features remain dark. If an Owner already created this row and
-- deliberately left it off, preserve that decision; only a missing row is
-- launched automatically. The application continues to treat this flag as a
-- runtime kill switch after launch.

insert into public.feature_flags (key, description, status, default_value)
values (
  'life_milestones',
  'Factual friendship milestones and private milestone reminders derived from shared Plans and friendship anniversaries.',
  'on',
  true
)
on conflict (key) do update
set
  description = excluded.description,
  updated_at = now();

-- Rollback is operational rather than destructive:
-- update public.feature_flags set status = 'off', default_value = false,
--   updated_at = now() where key = 'life_milestones';
