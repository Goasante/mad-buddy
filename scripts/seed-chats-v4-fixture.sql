-- Fixture for the Chats V4 server-action behavioural tests.
--
-- Four identities, three conversation types. Only things a product path cannot
-- create in SQL are inserted directly (auth users, profiles, conversations);
-- everything the actions themselves own is left for the actions to write, so
-- the tests prove the actions rather than the fixture.
--
--   A = member / sender
--   B = member
--   C = unrelated authenticated user (member of nothing here)
--   D = removed member

-- NOT `delete from auth.users`: that cascades into domain_events, which is
-- append-only and raises. The fixture is idempotent by upsert instead, so it
-- can be re-run safely between test runs.

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data,
                        confirmation_token, recovery_token,
                        email_change_token_new, email_change_token_current,
                        email_change, phone_change, phone_change_token,
                        reauthentication_token)
values
 ('4a000000-0000-4000-8000-00000000004a','00000000-0000-0000-0000-000000000000','authenticated','authenticated','a@v4test.local', crypt('Password123!', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}','{}','','','','','','','',''),
 ('4b000000-0000-4000-8000-00000000004b','00000000-0000-0000-0000-000000000000','authenticated','authenticated','b@v4test.local', crypt('Password123!', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}','{}','','','','','','','',''),
 ('4c000000-0000-4000-8000-00000000004c','00000000-0000-0000-0000-000000000000','authenticated','authenticated','c@v4test.local', crypt('Password123!', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}','{}','','','','','','','',''),
 ('4d000000-0000-4000-8000-00000000004d','00000000-0000-0000-0000-000000000000','authenticated','authenticated','d@v4test.local', crypt('Password123!', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}','{}','','','','','','','','')
on conflict (id) do nothing;

insert into public.profiles (user_id, full_name, username, is_onboarded)
values
 ('4a000000-0000-4000-8000-00000000004a','Adjoa','adjoa_v4',true),
 ('4b000000-0000-4000-8000-00000000004b','Bediako','bediako_v4',true),
 ('4c000000-0000-4000-8000-00000000004c','Comfort','comfort_v4',true),
 ('4d000000-0000-4000-8000-00000000004d','Delali','delali_v4',true)
on conflict (user_id) do update
  set full_name = excluded.full_name, username = excluded.username, is_onboarded = true;

-- A and B are mutual Muddies, which the direct-conversation rules require.
-- friendships stores ONE row per pair (user_one_id, user_two_id), active while
-- ended_at is null -- not two directional rows.
insert into public.friendships (user_one_id, user_two_id)
values ('4a000000-0000-4000-8000-00000000004a','4b000000-0000-4000-8000-00000000004b')
on conflict do nothing;

-- ---------------------------------------------------------------- DIRECT (A,B)
insert into public.conversations (id, conversation_type, created_by, status, direct_key)
values ('4d1a0000-0000-4000-8000-0000000d1a00','direct','4a000000-0000-4000-8000-00000000004a','active',
        '4a000000-0000-4000-8000-00000000004a:4b000000-0000-4000-8000-00000000004b')
on conflict (id) do nothing;
insert into public.conversation_members (conversation_id, user_id, role, status, history_visible_from)
values
 ('4d1a0000-0000-4000-8000-0000000d1a00','4a000000-0000-4000-8000-00000000004a','member','joined', to_timestamp(0)),
 ('4d1a0000-0000-4000-8000-0000000d1a00','4b000000-0000-4000-8000-00000000004b','member','joined', to_timestamp(0))
on conflict (conversation_id, user_id) do update set status='joined';

-- ----------------------------------------------------------------- GROUP (A,B,D)
insert into public.conversations (id, conversation_type, created_by, status)
values ('4c700000-0000-4000-8000-00000000c700','group','4a000000-0000-4000-8000-00000000004a','active')
on conflict (id) do nothing;
insert into public.group_settings (conversation_id, name, description)
values ('4c700000-0000-4000-8000-00000000c700','V4 Test Crew','Group fixture for action tests')
on conflict (conversation_id) do update set name = excluded.name;
insert into public.conversation_members (conversation_id, user_id, role, status, history_visible_from)
values
 ('4c700000-0000-4000-8000-00000000c700','4a000000-0000-4000-8000-00000000004a','owner','joined', to_timestamp(0)),
 ('4c700000-0000-4000-8000-00000000c700','4b000000-0000-4000-8000-00000000004b','member','joined', to_timestamp(0)),
 -- D was in the group and was removed: the canonical "lost access" identity.
 ('4c700000-0000-4000-8000-00000000c700','4d000000-0000-4000-8000-00000000004d','member','removed', to_timestamp(0))
on conflict (conversation_id, user_id) do update set status = excluded.status, role = excluded.role;

-- ------------------------------------------------------- EVENT ROOM (A host, B)
-- Built through the REAL Event Rooms lifecycle RPC so the room, its host
-- membership and its canonical conversation are created exactly as production
-- creates them -- no hand-made conversation row.
insert into public.events (id, host_id, name, starts_at, ends_at, status, visibility)
values ('4e000000-0000-4000-8000-00000000004e','4a000000-0000-4000-8000-00000000004a','V4 Test Event',
        now() - interval '30 minutes', now() + interval '6 hours','active','link')
on conflict (id) do update set status='active';

insert into public.check_ins (user_id, context_type, context_id, status, event_glow_enabled)
values
 ('4a000000-0000-4000-8000-00000000004a','event','4e000000-0000-4000-8000-00000000004e','checked_in',true),
 ('4b000000-0000-4000-8000-00000000004b','event','4e000000-0000-4000-8000-00000000004e','checked_in',true)
on conflict do nothing;

do $$
declare
  v_room uuid;
begin
  select id into v_room from public.event_circles
   where event_id = '4e000000-0000-4000-8000-00000000004e' and name = 'V4 Room';

  if v_room is null then
    v_room := public.create_event_room(
      '4a000000-0000-4000-8000-00000000004a',
      '4e000000-0000-4000-8000-00000000004e',
      'V4 Room', 'Room fixture for action tests', 'check_in', 50, true, '{}'::uuid[]);
  end if;

  perform public.join_event_room(v_room, '4b000000-0000-4000-8000-00000000004b');
end;
$$;

select
  (select count(*) from auth.users where email like '%@v4test.local') as users,
  (select count(*) from public.conversations where id in
     ('4d1a0000-0000-4000-8000-0000000d1a00','4c700000-0000-4000-8000-00000000c700')) as fixed_conversations,
  (select count(*) from public.conversations where context_type='event_circle'
     and context_id in (select id from public.event_circles where event_id='4e000000-0000-4000-8000-00000000004e')) as room_conversations;
