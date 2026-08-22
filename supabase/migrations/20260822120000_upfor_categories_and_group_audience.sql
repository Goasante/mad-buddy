-- UpFor 2.0 — the category vocabulary the approved screen needs, and Groups as
-- a real audience target.
--
-- Two changes, both deliberately additive. Production currently holds 42 live
-- UpFors spread across all eight existing activity types, so nothing here
-- rewrites a single existing row.
--
-- Rollback:
--   alter table public.hangout_sessions drop constraint hangout_sessions_activity_type_check;
--   alter table public.hangout_sessions add constraint hangout_sessions_activity_type_check
--     check (activity_type in ('food','study','sports','gym','walk','gaming','chill','anything'));
--   alter table public.hangout_audience_targets drop constraint hangout_audience_targets_target_type_check;
--   alter table public.hangout_audience_targets add constraint hangout_audience_targets_target_type_check
--     check (target_type in ('circle','user'));

-- ---------------------------------------------------------------------------
-- 1. Categories: six added, none removed, none rewritten.
--
-- The approved screen shows twelve intents. Eight already exist. The obvious
-- move -- rename `sports` to `football` and drop `chill` -- is wrong on both
-- counts, and production data is what says so:
--
--   sports  2 rows.  "Sports ⚽" is the label people chose. Some of those may
--                    be basketball or a run. Rewriting them to `football`
--                    would put words in their author's mouth, so `sports`
--                    stays canonical and `football` joins it as a SEPARATE,
--                    more specific intent. A person who means football now
--                    says football; a person who meant sports still means
--                    sports.
--
--   chill  10 rows.  The single most used category after food. "Chill 🌙" is
--                    a real intent -- doing nothing in particular, together --
--                    and it maps onto nothing in the reference. Dropping it to
--                    match a mockup would delete the second-most-popular thing
--                    people actually say.
--
-- So this is a strict superset: fourteen values, every existing row still
-- valid, no backfill, no data loss.
-- ---------------------------------------------------------------------------
alter table public.hangout_sessions
  drop constraint if exists hangout_sessions_activity_type_check;

alter table public.hangout_sessions
  add constraint hangout_sessions_activity_type_check
  check (
    activity_type in (
      -- Existing, untouched.
      'food', 'study', 'sports', 'gym', 'walk', 'gaming', 'chill', 'anything',
      -- Added for the approved screen.
      'coffee', 'football', 'drinks', 'movie', 'drive', 'party'
    )
  );

comment on column public.hangout_sessions.activity_type is
  'What the person is up for. A strict superset of the original eight: sports and football coexist deliberately (sports is the broader legacy intent), and chill is retained because it is the second most used value in production.';

-- ---------------------------------------------------------------------------
-- 2. Groups as an audience target.
--
-- A Group in this product IS a group conversation: `group_settings` is keyed
-- by `conversation_id`, and membership is `conversation_members`. There is no
-- separate groups table, and there does not need to be one.
--
-- WHY `group` IS NOT `circle`. A Circle is a private, member-only conversation.
-- A public Group is the same row with `group_settings.visibility = 'public'`.
-- Collapsing them into one target type would make "post this to my Circle" and
-- "post this to a public community" indistinguishable at the point where the
-- audience is enforced -- which is exactly where the difference matters most.
--
-- The target_id is a conversation id in both cases; the type is what tells the
-- audience resolver which rules to apply.
-- ---------------------------------------------------------------------------
alter table public.hangout_audience_targets
  drop constraint if exists hangout_audience_targets_target_type_check;

alter table public.hangout_audience_targets
  add constraint hangout_audience_targets_target_type_check
  check (target_type in ('circle', 'user', 'group'));

comment on column public.hangout_audience_targets.target_type is
  'circle = private group conversation, user = a specific Muddy, group = a conversation whose group_settings.visibility is public. All three carry a conversation or user id in target_id.';

-- ---------------------------------------------------------------------------
-- 3. The audience_type a Group-targeted UpFor uses.
--
-- `selected_circles` already exists and means "these specific conversations".
-- Adding `selected_groups` keeps the two readable apart in a query and in a
-- log, rather than overloading one value with two different privacy stories.
-- ---------------------------------------------------------------------------
alter table public.hangout_sessions
  drop constraint if exists hangout_sessions_audience_type_check;

alter table public.hangout_sessions
  add constraint hangout_sessions_audience_type_check
  check (
    audience_type in (
      'all_muddies', 'close_friends', 'selected_circles', 'selected_muddies',
      -- Added: visible inside specific public Groups.
      'selected_groups'
    )
  );

-- Discovery reads targets by type, so the index carries it.
create index if not exists hangout_targets_type_target_idx
  on public.hangout_audience_targets(target_type, target_id);
