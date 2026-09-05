-- ---------------------------------------------------------------------------
-- profiles: make the deployed authority match the designed one.
--
-- D4 granted the browser roles exactly what they need on `profiles`: SELECT,
-- plus UPDATE on the owner-editable columns. A migrations-only database ends up
-- that way. A Supabase-hosted one does not: `alter default privileges ... in
-- schema public grant all on tables to anon, authenticated` (owned by
-- supabase_admin) means every table CREATEd there starts with arwdDxtm for both
-- browser roles, and those platform grants sit underneath the migration's.
--
-- Production therefore held table-wide INSERT/UPDATE/DELETE on `profiles` for
-- anon and authenticated, which local never reproduced. Verified: grantor is
-- `postgres`, PUBLIC holds nothing, so a scoped REVOKE genuinely removes it.
--
-- WHY IT MATTERS, precisely
--
-- RLS restricts ROWS, not COLUMNS. `profiles owner full access` is FOR ALL on
-- auth.uid() = user_id, so it correctly stops one person editing another's row
-- -- cross-user access was never open. But combined with table-wide UPDATE it
-- let an owner rewrite their OWN server- and staff-controlled columns:
-- trusted_member_since is granted by staff review, is_onboarded and deleted_at
-- are written only through the admin client. Column privileges are the only
-- thing that separates "edit my profile" from "grant myself Trusted Member".
--
-- anon was never actually able to write: RLS is enabled and no policy on this
-- table targets anon, so every anon write already failed at the row level. The
-- grant was dead authority. It is removed anyway -- a privilege nothing may use
-- should not be held, and the next policy added to this table should not
-- silently inherit an audience.
--
-- INSERT is not restored for authenticated. D4 granted it because the edit path
-- used .upsert(), which needs INSERT even when only updating. D6 changed that to
-- an owner-scoped UPDATE, so browser INSERT on profiles is now zero: creating a
-- profile is ensureProfileForUser()'s job, through the admin client.
--
-- SCOPE. This repairs `profiles`. The same platform default affects most public
-- tables, and a schema-wide revoke is a much larger blast radius that deserves
-- its own reviewed tranche -- notably because 75 tables carry FOR ALL/UPDATE
-- policies whose column exposure each need checking. Recorded, not silently
-- widened here.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Remove every table-wide DML privilege the browser roles hold.
--
-- Column grants are not affected by a table-level REVOKE, so this is written to
-- leave nothing behind: the column grants are re-stated explicitly below.
-- ---------------------------------------------------------------------------
revoke insert, update, delete, truncate on public.profiles from anon;
revoke insert, update, delete, truncate on public.profiles from authenticated;

-- anon reads nothing here directly. Discovery and profile views run through the
-- authenticated session or the server; an unauthenticated caller has no policy
-- on this table, so SELECT is dead authority in the same way the writes were.
revoke select on public.profiles from anon;

-- Column-level privileges survive a table-level revoke, so D4's column INSERT
-- is removed by name. Nothing browser-side creates a profile after D6.
revoke insert (user_id, full_name, username, username_normalized, bio, mood_status)
  on public.profiles from authenticated;

-- ---------------------------------------------------------------------------
-- 2. Restate the intended authority.
--
-- SELECT stays: `profiles owner full access` and "friends can view limited
-- profiles" both need it, and the row filtering is the policies' job.
-- ---------------------------------------------------------------------------
grant select on public.profiles to authenticated;

-- The owner-editable surface, and nothing else. Every other column --
-- trusted_member_since, is_onboarded, deleted_at, created_at, updated_at,
-- user_id, id, avatar_url, profile_media_id, institution, programme,
-- graduation_year, general_area, pronouns, username_changed_at -- is written by
-- the server or by staff, and stays unwritable from a browser session.
--
-- avatar_url and profile_media_id are deliberately absent: the avatar is set by
-- uploadAvatarAction through the admin client after magic-byte validation, not
-- by the client naming its own storage path.
grant update (full_name, username, username_normalized, bio, mood_status, visibility_status)
  on public.profiles to authenticated;

-- service_role is the server's identity: a REVOKE above could strip it if the
-- roles ever overlap, and a fresh database has 42501'd app-wide before for
-- exactly this reason. Restated so the server is never in doubt.
grant select, insert, update, delete on public.profiles to service_role;

comment on table public.profiles is
  'Browser roles hold SELECT plus UPDATE on the six owner-editable columns only. Creation is server-side (ensureProfileForUser); staff/system columns are not browser-writable. RLS scopes rows, column grants scope fields. See 20260905090000.';
