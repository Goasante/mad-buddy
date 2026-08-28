-- E2E fixture for the two join gates that were previously proven only by unit
-- test: invite-only admission and Group-members admission.
--
-- Everything a PRODUCT path can create is created by that path (rooms come from
-- create_event_room). Only the things a product path cannot create in SQL --
-- auth users, profiles, an existing persistent Group -- are inserted directly.

-- Users: A hosts, B is the eligible one, C is the excluded one.
delete from auth.users where email like '%@mbgate.local';

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data,
                        confirmation_token, recovery_token,
                        email_change_token_new, email_change_token_current,
                        email_change, phone_change, phone_change_token,
                        reauthentication_token)
values
 ('a0000000-0000-4000-8000-00000000000a','00000000-0000-0000-0000-000000000000','authenticated','authenticated','hosta@mbgate.local', crypt('Password123!', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}','{}','','','','','','','',''),
 ('b0000000-0000-4000-8000-00000000000b','00000000-0000-0000-0000-000000000000','authenticated','authenticated','userb@mbgate.local', crypt('Password123!', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}','{}','','','','','','','',''),
 ('c0000000-0000-4000-8000-00000000000c','00000000-0000-0000-0000-000000000000','authenticated','authenticated','userc@mbgate.local', crypt('Password123!', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}','{}','','','','','','','','');

insert into auth.identities (id, user_id, identity_data, provider, provider_id,
                             last_sign_in_at, created_at, updated_at)
select id, id, jsonb_build_object('sub', id::text, 'email', email), 'email', id::text, now(), now(), now()
from auth.users where email like '%@mbgate.local'
on conflict do nothing;

insert into public.profiles (user_id, full_name, username, is_onboarded)
values
 ('a0000000-0000-4000-8000-00000000000a','Akosua (Host)','akosuahost',true),
 ('b0000000-0000-4000-8000-00000000000b','Bright','brightb',true),
 ('c0000000-0000-4000-8000-00000000000c','Cynthia','cynthiac',true)
on conflict (user_id) do update
  set full_name = excluded.full_name, username = excluded.username, is_onboarded = true;

-- A live Event, link-visible so audience rules do not mask the join gates.
insert into public.events (id, host_id, name, description, venue_label,
                           starts_at, ends_at, status, visibility)
values ('e0000000-0000-4000-8000-00000000000e','a0000000-0000-4000-8000-00000000000a',
        'Gate Test Rooftop','Proving the join gates.','Skyline Lounge, Accra',
        now() - interval '30 minutes', now() + interval '6 hours','active','link')
on conflict (id) do update set status='active', visibility='link',
  starts_at = excluded.starts_at, ends_at = excluded.ends_at;

-- A REAL persistent Group: conversation_type 'group' + group_settings, which is
-- exactly the authority the community gate reads. A and B are members; C is not.
insert into public.conversations (id, conversation_type, created_by, status)
values ('60000000-0000-4000-8000-000000000060','group','a0000000-0000-4000-8000-00000000000a','active')
on conflict (id) do nothing;

insert into public.group_settings (conversation_id, name, description)
values ('60000000-0000-4000-8000-000000000060','Rooftop Regulars','The people who always show up')
on conflict (conversation_id) do update set name = excluded.name;

insert into public.conversation_members (conversation_id, user_id, role, status)
values
 ('60000000-0000-4000-8000-000000000060','a0000000-0000-4000-8000-00000000000a','owner','joined'),
 ('60000000-0000-4000-8000-000000000060','b0000000-0000-4000-8000-00000000000b','member','joined')
on conflict (conversation_id, user_id) do update set status='joined';

-- A second Group that NOBODY relevant is in, to prove "wrong Group" is refused.
insert into public.conversations (id, conversation_type, created_by, status)
values ('61000000-0000-4000-8000-000000000061','group','a0000000-0000-4000-8000-00000000000a','active')
on conflict (id) do nothing;
insert into public.group_settings (conversation_id, name)
values ('61000000-0000-4000-8000-000000000061','Other Crew')
on conflict (conversation_id) do update set name = excluded.name;
insert into public.conversation_members (conversation_id, user_id, role, status)
values ('61000000-0000-4000-8000-000000000061','a0000000-0000-4000-8000-00000000000a','owner','joined')
on conflict (conversation_id, user_id) do update set status='joined';

-- B and C both check in, so the CHECK-IN gate is satisfied for both. Any refusal
-- below is therefore attributable to the invite/group gate and nothing else.
insert into public.check_ins (user_id, context_type, context_id, status, event_glow_enabled)
values
 ('b0000000-0000-4000-8000-00000000000b','event','e0000000-0000-4000-8000-00000000000e','checked_in',true),
 ('c0000000-0000-4000-8000-00000000000c','event','e0000000-0000-4000-8000-00000000000e','checked_in',true)
on conflict do nothing;

-- Rooms via the REAL product path.
select public.create_event_room(
  'a0000000-0000-4000-8000-00000000000a','e0000000-0000-4000-8000-00000000000e',
  'Invite Only Room','Only invited people can join','invite',50,true,'{}'::uuid[]) as invite_room;

select public.create_event_room(
  'a0000000-0000-4000-8000-00000000000a','e0000000-0000-4000-8000-00000000000e',
  'Regulars Room','Members of selected Groups','community',50,true,
  array['60000000-0000-4000-8000-000000000060']::uuid[]) as group_room;

select name, join_mode, status from public.event_circles
where event_id='e0000000-0000-4000-8000-00000000000e' order by created_at;
