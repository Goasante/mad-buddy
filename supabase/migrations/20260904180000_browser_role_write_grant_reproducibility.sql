-- ---------------------------------------------------------------------------
-- Browser-role WRITE authority: the half 20260903140000 left behind.
--
-- That migration granted the browser roles their SELECTs and stopped there. But
-- several product paths mutate through an RLS-scoped client, and RLS can only
-- NARROW a base privilege -- it can never supply one. So a table could carry a
-- perfectly good owner policy and still reject the write:
--
--   profiles has "profiles owner full access" (FOR ALL, auth.uid() = user_id)
--   yet authenticated held only SELECT, so
--   updateVisibilityStatus() -> UPDATE profiles SET visibility_status
--   failed with 42501 on any freshly built database, and a new account could
--   never leave `ghost` -- Turn on Glow could not complete.
--
-- Repaired here for the two tables the product actually writes over a
-- browser-role transport and that are missing the privilege.
--
-- WHY COLUMN-LEVEL ON profiles
--
-- A table-level UPDATE would have been the small fix and the wrong one. RLS
-- restricts which ROWS an owner may touch; it says nothing about which COLUMNS.
-- Combined with a FOR ALL owner policy, table-level UPDATE would let any signed
-- in user rewrite their own staff- and server-controlled fields --
-- trusted_member_since above all, which is granted by staff review, plus
-- is_onboarded and deleted_at, both written only through the admin client.
-- Column privileges keep row ownership from becoming privilege escalation.
--
-- The granted columns are exactly what browser-role code writes today:
--   updateProfile()          -> full_name, username, username_normalized,
--                               bio, mood_status   (upsert, so INSERT too)
--   updateVisibilityStatus() -> visibility_status
-- Anything else on profiles stays server-only. Adding a column here is a
-- deliberate security decision, not a routine edit.
-- ---------------------------------------------------------------------------

-- profiles: the owner-editable surface, and nothing else.
grant insert (user_id, full_name, username, username_normalized, bio, mood_status)
  on public.profiles to authenticated;

grant update (full_name, username, username_normalized, bio, mood_status, visibility_status)
  on public.profiles to authenticated;

-- profile_field_privacy: the per-field visibility choices a person sets for
-- their own birthday/age/zodiac. Held NO privilege at all, so saving privacy
-- choices failed the same way. Whole-table is right here: every column is the
-- owner's own choice, and "profile field privacy owner access" (FOR ALL,
-- auth.uid() = user_id) already confines it to their rows.
--
-- SELECT belongs in this list, and not only because the profile page reads
-- these rows back: the product saves them with .upsert(..., { onConflict:
-- 'user_id,field_name' }), and PostgREST must read the conflict target to
-- resolve it. Granting INSERT and UPDATE alone leaves the upsert failing 42501
-- with the writes technically permitted -- the confusing half-fix.
grant select, insert, update on public.profile_field_privacy to authenticated;

-- Deliberately NOT granted:
--   * DELETE anywhere -- no browser path deletes either table; account
--     deletion runs server-side.
--   * anything to `anon` -- an unauthenticated caller writes nothing here.
--   * ALTER DEFAULT PRIVILEGES for browser roles -- a future table must earn
--     its grant by review, exactly as these two did.

comment on table public.profile_field_privacy is
  'Per-field visibility choices, owner-writable from the browser role. Base INSERT/UPDATE granted in 20260904180000; row scope enforced by "profile field privacy owner access".';
