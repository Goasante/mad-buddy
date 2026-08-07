-- Socialize 2.0 — public group discovery.
--
-- Today a group is discoverable only when `join_mode = 'link'` AND its creator
-- is already one of your Muddies. That is "groups my friends made", not
-- discovery: a user with no Muddies can never find a community, and no group
-- can ever reach beyond one social hop.
--
-- This adds a genuine visibility axis, deliberately SEPARATE from join_mode:
--
--   visibility  who can SEE the group exists      (private | public)
--   join_mode   what happens when they try to join (invite | link | closed)
--
-- Keeping them separate matters. A public group may still be invite-only —
-- browsable, but you ask to join. Collapsing the two would have forced every
-- discoverable group to also be openly joinable, which is a different and much
-- riskier product decision.
--
-- DEFAULT IS PRIVATE. Every group that exists today was created under a model
-- where only members could see it, and its members never consented to being
-- listed publicly. A default of 'public' would retroactively expose all of
-- them, so existing rows keep exactly the visibility they were created with.
--
-- Rollback:
--   drop policy "public groups discoverable" on public.group_settings;
--   drop index if exists group_settings_public_discovery_idx;
--   alter table public.group_settings drop column visibility;

alter table public.group_settings
  add column if not exists visibility text not null default 'private'
    check (visibility in ('private', 'public'));

-- ---------------------------------------------------------------------------
-- Discovery read access.
-- ---------------------------------------------------------------------------
-- The existing policy ("group settings visible to members") stays exactly as
-- it is — members keep full access. This ADDS a narrow second path so a
-- non-member can see that a PUBLIC group exists.
--
-- Postgres ORs multiple permissive SELECT policies, so this widens visibility
-- only for rows that opted in, and only for signed-in users. It exposes the
-- same row shape members already see; there is no separate "public view" that
-- could drift from it.
--
-- What this does NOT grant: membership, message history, or the member list.
-- `conversation_members` and `messages` policies are untouched, so a
-- discoverable group is a name, a description and a count — never a way to
-- read what people said in it.

create policy "public groups discoverable" on public.group_settings
  for select using (
    visibility = 'public'
    and auth.uid() is not null
    and exists (
      select 1 from public.conversations c
      where c.id = group_settings.conversation_id
        and c.conversation_type = 'group'
        -- An archived or deleted group is not discoverable, whatever its
        -- visibility said when it was active.
        and c.status = 'active'
    )
  );

-- Partial index: the discovery query filters on exactly this predicate, and a
-- full index would carry every private group for no benefit.
create index if not exists group_settings_public_discovery_idx
  on public.group_settings(conversation_id)
  where visibility = 'public';

comment on column public.group_settings.visibility is
  'Who can SEE the group exists. Separate from join_mode, which controls what happens when they try to join. Defaults to private so existing groups are never retroactively exposed.';
