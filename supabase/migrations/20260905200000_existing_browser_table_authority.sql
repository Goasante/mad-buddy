-- ---------------------------------------------------------------------------
-- SEC-003, existing objects: bring the 191 tables already in `public` into line
-- with the authority model 20260905193000 established for future ones.
--
-- The audit traced every `.from(...).insert/upsert/update/delete` in app/, lib/,
-- components/ and hooks/ to the client actually in scope at the call site.
-- Thirteen tables have a legitimate browser-role write. The rest are written
-- only through the admin client, where authorization already lives in the
-- server action -- so on those, browser DML is authority nothing uses, and on a
-- hosted project it is reachable directly through PostgREST with RLS as the
-- only remaining boundary.
--
-- SHAPE OF THIS MIGRATION
--
--   1. revoke browser DML everywhere, including the DDL-adjacent privileges
--   2. restate the thirteen legitimate paths, column-scoped where possible
--
-- Written in that order deliberately: a blanket revoke followed by explicit
-- re-grants is auditable in a way that 191 individual decisions is not, and it
-- cannot leave a table behind.
--
-- SELECT IS NOT TOUCHED. 79 tables have a SELECT policy but no
-- migration-granted SELECT -- they work in production only because of the
-- hosted platform default. Revoking read authority here would break those read
-- paths with no way to tell which, so read-grant normalization is deliberately
-- left out of this tranche. The only SELECTs granted below are the ones an
-- upsert needs to see its own conflict target.
--
-- service_role is untouched throughout. 20260903120000 owns it.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Remove browser write and DDL-adjacent authority from every public table.
--
-- TRUNCATE, REFERENCES and TRIGGER come from the platform default ACL too
-- (`Dxtm`) and no browser path uses any of them. MAINTAIN is included for
-- PostgreSQL 17, where it is part of that same default.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  v_count integer := 0;
begin
  for r in
    select format('%I.%I', n.nspname, c.relname) as tbl
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
    order by c.relname
  loop
    execute format(
      'revoke insert, update, delete, truncate, references, trigger on table %s from public, anon, authenticated',
      r.tbl
    );
    -- MAINTAIN exists only on PostgreSQL 17+; ignore the parse error elsewhere.
    begin
      execute format('revoke maintain on table %s from public, anon, authenticated', r.tbl);
    exception when syntax_error or feature_not_supported then
      null;
    end;
    v_count := v_count + 1;
  end loop;

  if v_count = 0 then
    raise exception 'SEC-003: no public tables found -- refusing to report success';
  end if;
  raise notice 'SEC-003: browser write authority cleared on % tables', v_count;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Restate the thirteen legitimate browser-write paths.
--
-- Column lists come from the object literal each caller actually sends. An
-- `.upsert()` needs INSERT *and* UPDATE, and SELECT on the conflict target --
-- PostgREST has to read the existing row to resolve ON CONFLICT. Missing that
-- SELECT is what made profile_field_privacy 42501 during D4.
-- ---------------------------------------------------------------------------

-- profiles: settled by R2.0.1 (20260905090000). Restated so this migration's
-- blanket revoke above does not silently drop it.
grant update (full_name, username, username_normalized, bio, mood_status, visibility_status)
  on table public.profiles to authenticated;

-- profile_field_privacy: lib/profile/service.ts upserts on (user_id, field_name).
grant select, insert, update on table public.profile_field_privacy to authenticated;

-- ---------------------------------------------------------------------------
-- UPSERT PATHS NEED TABLE-LEVEL INSERT AND UPDATE.
--
-- Measured, not assumed: PostgREST checks the TABLE privilege before it
-- resolves which columns the request touches, so a column-scoped UPDATE makes
-- `.upsert()` fail
--
--   403 42501 "permission denied for table user_preferences"
--   hint: GRANT UPDATE ON public.user_preferences TO authenticated
--
-- even when every column being written is granted. `profile_field_privacy`
-- survived D4 only because it was given table-level INSERT/UPDATE.
--
-- Column scoping is therefore reserved for the plain-UPDATE paths (`profiles`)
-- and the INSERT-only paths below, where it works. On these four the row filter
-- is RLS's job, and each has an owner policy: a person can only upsert their
-- own row. The columns are also all user-owned -- there is no
-- trusted_member_since equivalent among them.
-- ---------------------------------------------------------------------------

-- push_subscriptions: upsert on `endpoint`, plus a real delete path
-- (push-actions.ts, (auth)/actions.ts sign-out, api/push-subscriptions).
grant select, insert, update, delete on table public.push_subscriptions to authenticated;

-- user_preferences: three upserts in premium-actions on (user_id).
grant select, insert, update on table public.user_preferences to authenticated;

-- blocked_users: upsert to block, delete to unblock (actions.ts:462, :542).
grant select, insert, update, delete on table public.blocked_users to authenticated;

-- best_buddies: upsert on (user_id, friend_id).
grant select, insert, update on table public.best_buddies to authenticated;

-- Insert-only paths. No UPDATE or DELETE grant: editing and removal run
-- through the admin client, where the server action does the authorization.
grant insert (user_id, category, rating, message)
  on table public.app_feedback to authenticated;

grant insert (circle_id, friend_id)
  on table public.circle_members to authenticated;

grant insert (user_id, name, description, visibility_rule)
  on table public.friend_circles to authenticated;

grant insert (user_id, name, latitude, longitude, radius, is_active)
  on table public.privacy_zones to authenticated;

grant insert (user_id, name, starts_at, ends_at, visibility_rule, is_active)
  on table public.event_modes to authenticated;

-- support_tickets: help-actions.ts:46 sends status and priority, and the RLS
-- policy already pins both to their opening values ('new'/'normal') along with
-- assigned_to IS NULL and resolved_at IS NULL. The column grant matches what
-- the caller sends; RLS is what stops it lying.
-- `subject` is passed as an ES shorthand property in help-actions.ts, which is
-- why it has to be read from the caller rather than pattern-matched.
grant insert (user_id, category, subject, description, diagnostics, priority, status)
  on table public.support_tickets to authenticated;

-- reports: 20260905194000 owns this table's authority. Restated because the
-- blanket revoke above runs after it in a fresh build.
grant insert (reporter_id, reported_user_id, reason, description)
  on table public.reports to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Prove the result rather than trusting the loop.
-- ---------------------------------------------------------------------------
do $$
declare
  v_anon text;
  v_unexpected text;
begin
  select coalesce(string_agg(distinct table_name, ', '), '')
    into v_anon
  from information_schema.role_table_grants
  where table_schema = 'public' and grantee = 'anon'
    and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER');

  if v_anon <> '' then
    raise exception 'SEC-003: anon still holds write authority on: %', v_anon;
  end if;

  select coalesce(string_agg(distinct table_name, ', '), '')
    into v_unexpected
  from information_schema.role_table_grants
  where table_schema = 'public' and grantee = 'authenticated'
    and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
    and table_name not in (
      'profiles', 'profile_field_privacy', 'push_subscriptions', 'user_preferences',
      'blocked_users', 'best_buddies', 'app_feedback', 'circle_members',
      'friend_circles', 'privacy_zones', 'event_modes', 'support_tickets', 'reports'
    );

  if v_unexpected <> '' then
    raise exception 'SEC-003: authenticated holds unexpected write authority on: %', v_unexpected;
  end if;

  raise notice 'SEC-003: verified -- anon writes 0, authenticated writes confined to the traced 13';
end $$;
