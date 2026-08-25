-- Controlled local users for the Linkr Tranche 2 runtime journey.
--
-- LOCAL ONLY. Creates four throwaway accounts (A, B, C, and outsider D) with
-- the minimum a Linkr candidate needs: a confirmed auth user, a profile with
-- an avatar, an adult date of birth, and an enabled Linkr profile.
--
-- Idempotent: re-running resets the pair back to a clean pre-decision state
-- rather than accumulating fixtures.

begin;

-- Deterministic ids so every step of the journey can address them.
create temp table t2_people(label text, id uuid, email text, name text) on commit drop;
insert into t2_people values
  ('A', '0a000000-0000-4000-8000-00000000000a', 'linkr-t2-a@local.test', 'Ama Test'),
  ('B', '0b000000-0000-4000-8000-00000000000b', 'linkr-t2-b@local.test', 'Kofi Test'),
  ('C', '0c000000-0000-4000-8000-00000000000c', 'linkr-t2-c@local.test', 'Yaa Test'),
  ('D', '0d000000-0000-4000-8000-00000000000d', 'linkr-t2-d@local.test', 'Dede Outsider');

-- Auth users, pre-confirmed (never supabase.auth.signUp: that path sends a
-- rate-limited confirmation email and is not usable for fixtures).
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data
)
select
  p.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  p.email, crypt('LinkrT2!local', gen_salt('bf')),
  now(), now(), now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('full_name', p.name)
from t2_people p
on conflict (id) do update set email_confirmed_at = now(), updated_at = now();

-- Profiles. An avatar_url is required: the Linkr projection treats "has a
-- profile picture" as the gate for appearing at all.
insert into public.profiles (user_id, full_name, username, avatar_url, visibility_status)
select p.id, p.name, lower(replace(p.label, ' ', '')) || '_t2',
       'http://127.0.0.1:54321/storage/v1/object/public/avatars/' || p.id || '/a.jpg',
       'visible'
from t2_people p
on conflict (user_id) do update
  set full_name = excluded.full_name,
      avatar_url = excluded.avatar_url,
      visibility_status = 'visible',
      deleted_at = null;

-- Adult date of birth. Lives in its own table: identity data is scoped away
-- from the general profile row, and resolveAge reads it from there.
insert into public.profile_birth_details (user_id, date_of_birth)
select p.id, date '1995-06-15' from t2_people p
on conflict (user_id) do update set date_of_birth = excluded.date_of_birth;

-- Linkr enabled for everyone, so eligibility is decided by the rules under
-- test rather than by somebody being switched off.
insert into public.linkr_profiles (user_id, enabled, intent, discovery_distance)
select p.id, true, 'friends', 'around_you' from t2_people p
on conflict (user_id) do update set enabled = true;

-- Clean slate for the decisions themselves.
delete from public.linkr_actions
 where actor_id in (select id from t2_people)
    or target_id in (select id from t2_people);
delete from public.linkr_connections
 where user_low in (select id from t2_people)
    or user_high in (select id from t2_people);
delete from public.notifications
 where user_id in (select id from t2_people) and type like 'linkr_connection%';
delete from public.blocked_users
 where blocker_id in (select id from t2_people)
    or blocked_id in (select id from t2_people);

commit;

select label, id from (
  select 'A' label, '0a000000-0000-4000-8000-00000000000a'::uuid id
  union all select 'B', '0b000000-0000-4000-8000-00000000000b'
  union all select 'C', '0c000000-0000-4000-8000-00000000000c'
  union all select 'D', '0d000000-0000-4000-8000-00000000000d'
) x order by label;
