begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- Disposable identities. These rows and every dependent fixture are rolled
-- back at the end of this test file.
insert into auth.users (id, aud, role, email, encrypted_password, created_at, updated_at)
values
  ('10000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'plan-host-a@test.invalid', 'x', now(), now()),
  ('20000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'plan-friend-b@test.invalid', 'x', now(), now()),
  ('30000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'plan-friend-c@test.invalid', 'x', now(), now()),
  ('40000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'plan-blocked-d@test.invalid', 'x', now(), now()),
  ('50000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'plan-host-e@test.invalid', 'x', now(), now()),
  ('60000000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'plan-friend-f@test.invalid', 'x', now(), now());

insert into public.friendships (user_one_id, user_two_id)
values
  ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002'),
  ('10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000003'),
  ('10000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000004'),
  ('50000000-0000-4000-8000-000000000005', '60000000-0000-4000-8000-000000000006');

insert into public.blocked_users (blocker_id, blocked_id)
values ('40000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001');

-- Schema and permissions.
select ok(
  to_regclass('public.plans_source_hangout_unique') is not null,
  'source_hangout_id has its canonical unique index'
);
select ok(
  to_regclass('public.hangout_sessions_converted_plan_unique') is not null,
  'converted_plan_id has its canonical unique index'
);
select ok(
  to_regclass('public.conversations_context_unique') is not null,
  'existing Plan context conversation uniqueness is preserved'
);
select ok(
  to_regclass('public.plan_participants_unique') is not null,
  'existing Plan participant uniqueness is preserved'
);

select is(
  bool_and(not has_function_privilege('public', p.oid, 'execute')),
  true,
  'PUBLIC cannot execute canonical Plan lifecycle functions'
)
from pg_proc as p
where p.pronamespace = 'public'::regnamespace
  and p.proname in (
    'create_plan_lifecycle',
    'reconcile_plan_conversation_members',
    'set_plan_participant_rsvp',
    'add_plan_participants'
  );
select is(
  bool_and(not has_function_privilege('anon', p.oid, 'execute')),
  true,
  'anon cannot execute canonical Plan lifecycle functions'
)
from pg_proc as p
where p.pronamespace = 'public'::regnamespace
  and p.proname in (
    'create_plan_lifecycle',
    'reconcile_plan_conversation_members',
    'set_plan_participant_rsvp',
    'add_plan_participants'
  );
select is(
  bool_and(not has_function_privilege('authenticated', p.oid, 'execute')),
  true,
  'authenticated cannot execute canonical Plan lifecycle functions'
)
from pg_proc as p
where p.pronamespace = 'public'::regnamespace
  and p.proname in (
    'create_plan_lifecycle',
    'reconcile_plan_conversation_members',
    'set_plan_participant_rsvp',
    'add_plan_participants'
  );
select is(
  bool_and(has_function_privilege('service_role', p.oid, 'execute')),
  true,
  'service_role can execute canonical Plan lifecycle functions'
)
from pg_proc as p
where p.pronamespace = 'public'::regnamespace
  and p.proname in (
    'create_plan_lifecycle',
    'reconcile_plan_conversation_members',
    'set_plan_participant_rsvp',
    'add_plan_participants'
  );

-- A normal Plan: C is already Going while B is only invited.
set local role service_role;
create temp table test_created on commit drop as
select *
from public.create_plan_lifecycle(
  p_actor_id => '10000000-0000-4000-8000-000000000001',
  p_request_key => 'a0000000-0000-4000-8000-000000000001',
  p_title => 'Canonical normal Plan',
  p_description => null,
  p_plan_type => 'quick',
  p_start_at => null,
  p_end_at => null,
  p_timezone => 'UTC',
  p_rsvp_deadline => null,
  p_place_type => 'decide_in_chat',
  p_custom_place_text => null,
  p_reminder_minutes => null,
  p_category => 'coffee',
  p_invitee_ids => array[
    '20000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000002',
    '30000000-0000-4000-8000-000000000003'
  ]::uuid[],
  p_initial_going_ids => array['30000000-0000-4000-8000-000000000003']::uuid[],
  p_source_hangout_id => null,
  p_effective_max_active_plans => 10,
  p_effective_max_participants => 3
);
reset role;

select is((select created from test_created), true, 'first normal request creates a Plan');
select is(
  (select count(*) from public.plans where id = (select plan_id from test_created)),
  1::bigint,
  'normal lifecycle creates exactly one Plan'
);
select is(
  (select count(*) from public.plan_participants where plan_id = (select plan_id from test_created)),
  3::bigint,
  'duplicate participant ids are deduplicated before insertion'
);
select is(
  (select count(*) from public.conversations where context_type = 'plan' and context_id = (select plan_id from test_created)),
  1::bigint,
  'normal lifecycle creates exactly one Plan conversation'
);
select is(
  (select count(*) from public.conversation_members where conversation_id = (select conversation_id from test_created) and user_id = '10000000-0000-4000-8000-000000000001' and role = 'owner' and status = 'joined'),
  1::bigint,
  'host is joined as Plan Chat owner'
);
select is(
  (select count(*) from public.conversation_members where conversation_id = (select conversation_id from test_created) and user_id = '30000000-0000-4000-8000-000000000003' and status = 'joined'),
  1::bigint,
  'Going participant is joined to Plan Chat'
);
select is(
  (select count(*) from public.conversation_members where conversation_id = (select conversation_id from test_created) and user_id = '20000000-0000-4000-8000-000000000002' and status = 'joined'),
  0::bigint,
  'invited participant is not joined to Plan Chat'
);

-- Retry the exact actor/request key.
set local role service_role;
create temp table test_retried on commit drop as
select *
from public.create_plan_lifecycle(
  p_actor_id => '10000000-0000-4000-8000-000000000001',
  p_request_key => 'a0000000-0000-4000-8000-000000000001',
  p_title => 'Ignored retry copy',
  p_description => null,
  p_plan_type => 'quick',
  p_start_at => null,
  p_end_at => null,
  p_timezone => 'UTC',
  p_rsvp_deadline => null,
  p_place_type => 'decide_in_chat',
  p_custom_place_text => null,
  p_reminder_minutes => null,
  p_category => 'coffee',
  p_invitee_ids => array['20000000-0000-4000-8000-000000000002']::uuid[],
  p_initial_going_ids => array[]::uuid[],
  p_source_hangout_id => null,
  p_effective_max_active_plans => 10,
  p_effective_max_participants => 3
);
reset role;

select is((select created from test_retried), false, 'completed retry returns the canonical result');
select is((select plan_id from test_retried), (select plan_id from test_created), 'retry returns the same Plan id');
select is((select conversation_id from test_retried), (select conversation_id from test_created), 'retry returns the same conversation id');
select is(
  (select count(*) from public.jobs where payload ->> 'planId' = (select plan_id::text from test_created)),
  3::bigint,
  'retry does not duplicate two invitations or first-Plan milestone work'
);

-- Same request key is isolated by actor.
set local role service_role;
create temp table test_other_actor on commit drop as
select *
from public.create_plan_lifecycle(
  p_actor_id => '50000000-0000-4000-8000-000000000005',
  p_request_key => 'a0000000-0000-4000-8000-000000000001',
  p_title => 'Other actor Plan',
  p_description => null,
  p_plan_type => 'quick',
  p_start_at => null,
  p_end_at => null,
  p_timezone => 'UTC',
  p_rsvp_deadline => null,
  p_place_type => 'decide_in_chat',
  p_custom_place_text => null,
  p_reminder_minutes => null,
  p_category => 'coffee',
  p_invitee_ids => array['60000000-0000-4000-8000-000000000006']::uuid[],
  p_initial_going_ids => array[]::uuid[],
  p_source_hangout_id => null,
  p_effective_max_active_plans => 10,
  p_effective_max_participants => 2
);
reset role;
select isnt((select plan_id from test_other_actor), (select plan_id from test_created), 'two actors do not collide on one request key');

-- RSVP and membership are one database transaction.
set local role service_role;
select * from public.set_plan_participant_rsvp(
  '20000000-0000-4000-8000-000000000002',
  (select plan_id from test_created),
  'maybe'
);
reset role;
select is(
  (select status from public.conversation_members where conversation_id = (select conversation_id from test_created) and user_id = '20000000-0000-4000-8000-000000000002'),
  'joined',
  'Maybe joins the canonical Plan Chat'
);

set local role service_role;
select * from public.set_plan_participant_rsvp(
  '20000000-0000-4000-8000-000000000002',
  (select plan_id from test_created),
  'not_going'
);
reset role;
select is(
  (select status from public.conversation_members where conversation_id = (select conversation_id from test_created) and user_id = '20000000-0000-4000-8000-000000000002'),
  'left',
  'Not Going loses active Plan Chat membership'
);

set local role service_role;
select * from public.set_plan_participant_rsvp(
  '20000000-0000-4000-8000-000000000002',
  (select plan_id from test_created),
  'going'
);
reset role;
select is(
  (select status from public.conversation_members where conversation_id = (select conversation_id from test_created) and user_id = '20000000-0000-4000-8000-000000000002'),
  'joined',
  'returning eligible participant rejoins Plan Chat'
);
select is(
  (select count(*) from public.conversation_members where conversation_id = (select conversation_id from test_created) and user_id = '20000000-0000-4000-8000-000000000002'),
  1::bigint,
  'rejoin reuses the canonical membership row'
);

-- Capacity and eligibility are validated inside the lifecycle transaction.
select throws_ok(
  $$select * from public.create_plan_lifecycle(
    '10000000-0000-4000-8000-000000000001',
    'a0000000-0000-4000-8000-000000000010',
    'Too many participants', null, 'quick', null, null, 'UTC', null,
    'decide_in_chat', null, null, 'coffee',
    array['20000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000003']::uuid[],
    array[]::uuid[], null, 10, 2
  )$$,
  'P0001',
  'PLAN_PARTICIPANT_LIMIT_REACHED',
  'host counts toward participant capacity'
);
select throws_ok(
  $$select * from public.create_plan_lifecycle(
    '10000000-0000-4000-8000-000000000001',
    'a0000000-0000-4000-8000-000000000011',
    'Blocked participant', null, 'quick', null, null, 'UTC', null,
    'decide_in_chat', null, null, 'coffee',
    array['40000000-0000-4000-8000-000000000004']::uuid[],
    array[]::uuid[], null, 10, 2
  )$$,
  'P0001',
  'PLAN_PARTICIPANT_INELIGIBLE',
  'blocked participant is rejected'
);

-- UpFor accepted requests map deliberately to Going and join Plan Chat.
insert into public.hangout_sessions (
  id, owner_id, activity_type, audience_type, starts_at, ends_at,
  max_participants, status
) values (
  '70000000-0000-4000-8000-000000000007',
  '10000000-0000-4000-8000-000000000001',
  'anything', 'all_muddies', now(), now() + interval '2 hours', 5, 'active'
);
insert into public.hangout_requests (hangout_session_id, requester_id, status, responded_at)
values
  ('70000000-0000-4000-8000-000000000007', '20000000-0000-4000-8000-000000000002', 'accepted', now()),
  ('70000000-0000-4000-8000-000000000007', '30000000-0000-4000-8000-000000000003', 'accepted', now());

set local role service_role;
create temp table test_upfor on commit drop as
select *
from public.create_plan_lifecycle(
  p_actor_id => '10000000-0000-4000-8000-000000000001',
  p_request_key => 'a0000000-0000-4000-8000-000000000020',
  p_title => 'Converted UpFor',
  p_description => null,
  p_plan_type => 'quick',
  p_start_at => null,
  p_end_at => null,
  p_timezone => 'UTC',
  p_rsvp_deadline => null,
  p_place_type => 'decide_in_chat',
  p_custom_place_text => null,
  p_reminder_minutes => null,
  p_category => 'coffee',
  p_invitee_ids => array[]::uuid[],
  p_initial_going_ids => array[]::uuid[],
  p_source_hangout_id => '70000000-0000-4000-8000-000000000007',
  p_effective_max_active_plans => 10,
  p_effective_max_participants => 3
);
reset role;

select is(
  (select converted_plan_id from public.hangout_sessions where id = '70000000-0000-4000-8000-000000000007'),
  (select plan_id from test_upfor),
  'UpFor conversion marker points to the canonical Plan'
);
select is(
  (select source_hangout_id from public.plans where id = (select plan_id from test_upfor)),
  '70000000-0000-4000-8000-000000000007'::uuid,
  'canonical Plan points back to its UpFor source'
);
select is(
  (select count(*) from public.plan_participants where plan_id = (select plan_id from test_upfor) and rsvp_status = 'going'),
  3::bigint,
  'accepted UpFor requests map to Going plus the host'
);
select is(
  (select count(*) from public.conversation_members where conversation_id = (select conversation_id from test_upfor) and status = 'joined'),
  3::bigint,
  'accepted UpFor participants join canonical Plan Chat'
);

set local role service_role;
create temp table test_upfor_retry on commit drop as
select *
from public.create_plan_lifecycle(
  '10000000-0000-4000-8000-000000000001',
  'a0000000-0000-4000-8000-000000000021',
  'Ignored second conversion', null, 'quick', null, null, 'UTC', null,
  'decide_in_chat', null, null, 'coffee', array[]::uuid[], array[]::uuid[],
  '70000000-0000-4000-8000-000000000007', 10, 3
);
reset role;
select is((select plan_id from test_upfor_retry), (select plan_id from test_upfor), 'converted UpFor retry returns the canonical Plan');
select is((select created from test_upfor_retry), false, 'converted UpFor retry reports no new creation');

-- Failure injection uses real PostgreSQL triggers. pgtap catches the error in
-- a subtransaction, so every lifecycle write must disappear together.
create or replace function pg_temp.fail_plan_lifecycle_stage()
returns trigger
language plpgsql
as $$
begin
  raise exception using errcode = 'P0001', message = 'TEST_INJECTED_FAILURE';
end;
$$;

create temp table test_failure_baseline on commit drop as
select
  (select count(*) from public.plans) as plans,
  (select count(*) from public.plan_participants) as participants,
  (select count(*) from public.conversations) as conversations,
  (select count(*) from public.conversation_members) as members,
  (select count(*) from public.jobs) as jobs,
  (select count(*) from public.idempotency_keys) as idempotency;

create trigger test_fail_participant
before insert on public.plan_participants
for each row execute function pg_temp.fail_plan_lifecycle_stage();
select throws_ok(
  $$select * from public.create_plan_lifecycle(
    '50000000-0000-4000-8000-000000000005',
    'a0000000-0000-4000-8000-000000000030',
    'Injected participant failure', null, 'quick', null, null, 'UTC', null,
    'decide_in_chat', null, null, 'coffee',
    array['60000000-0000-4000-8000-000000000006']::uuid[], array[]::uuid[], null, 20, 2
  )$$,
  'P0001', 'TEST_INJECTED_FAILURE',
  'participant insertion failure aborts lifecycle'
);
drop trigger test_fail_participant on public.plan_participants;

select is((select count(*) from public.plans), (select plans from test_failure_baseline), 'participant failure leaves no Plan');
select is((select count(*) from public.plan_participants), (select participants from test_failure_baseline), 'participant failure leaves no partial participant set');
select is((select count(*) from public.conversations), (select conversations from test_failure_baseline), 'participant failure leaves no Plan Chat');
select is((select count(*) from public.jobs), (select jobs from test_failure_baseline), 'participant failure queues no side effect');
select is((select count(*) from public.idempotency_keys), (select idempotency from test_failure_baseline), 'participant failure leaves no stuck idempotency row');

create trigger test_fail_conversation
before insert on public.conversations
for each row execute function pg_temp.fail_plan_lifecycle_stage();
select throws_ok(
  $$select * from public.create_plan_lifecycle(
    '50000000-0000-4000-8000-000000000005',
    'a0000000-0000-4000-8000-000000000031',
    'Injected conversation failure', null, 'quick', null, null, 'UTC', null,
    'decide_in_chat', null, null, 'coffee',
    array['60000000-0000-4000-8000-000000000006']::uuid[], array[]::uuid[], null, 20, 2
  )$$,
  'P0001', 'TEST_INJECTED_FAILURE',
  'conversation creation failure aborts lifecycle'
);
drop trigger test_fail_conversation on public.conversations;
select is((select count(*) from public.plans), (select plans from test_failure_baseline), 'conversation failure leaves no Plan');
select is((select count(*) from public.plan_participants), (select participants from test_failure_baseline), 'conversation failure leaves no participants');
select is((select count(*) from public.conversations), (select conversations from test_failure_baseline), 'conversation failure leaves no orphan Plan Chat');
select is((select count(*) from public.jobs), (select jobs from test_failure_baseline), 'conversation failure queues no side effect');

create trigger test_fail_membership
before insert on public.conversation_members
for each row execute function pg_temp.fail_plan_lifecycle_stage();
select throws_ok(
  $$select * from public.create_plan_lifecycle(
    '50000000-0000-4000-8000-000000000005',
    'a0000000-0000-4000-8000-000000000032',
    'Injected membership failure', null, 'quick', null, null, 'UTC', null,
    'decide_in_chat', null, null, 'coffee',
    array['60000000-0000-4000-8000-000000000006']::uuid[], array[]::uuid[], null, 20, 2
  )$$,
  'P0001', 'TEST_INJECTED_FAILURE',
  'membership reconciliation failure aborts lifecycle'
);
drop trigger test_fail_membership on public.conversation_members;
select is((select count(*) from public.plans), (select plans from test_failure_baseline), 'membership failure leaves no Plan');
select is((select count(*) from public.conversations), (select conversations from test_failure_baseline), 'membership failure leaves no conversation');
select is((select count(*) from public.conversation_members), (select members from test_failure_baseline), 'membership failure leaves no partial membership');
select is((select count(*) from public.jobs), (select jobs from test_failure_baseline), 'membership failure queues no side effect');

insert into public.hangout_sessions (
  id, owner_id, activity_type, ends_at, max_participants, status
) values (
  '70000000-0000-4000-8000-000000000008',
  '50000000-0000-4000-8000-000000000005',
  'chill', now() + interval '2 hours', 2, 'active'
);
insert into public.hangout_requests (
  hangout_session_id, requester_id, status, responded_at
) values (
  '70000000-0000-4000-8000-000000000008',
  '60000000-0000-4000-8000-000000000006',
  'accepted', now()
);

create trigger test_fail_conversion_marker
before update on public.hangout_sessions
for each row execute function pg_temp.fail_plan_lifecycle_stage();
select throws_ok(
  $$select * from public.create_plan_lifecycle(
    '50000000-0000-4000-8000-000000000005',
    'a0000000-0000-4000-8000-000000000034',
    'Injected conversion marker failure', null, 'quick', null, null, 'UTC', null,
    'decide_in_chat', null, null, 'coffee', array[]::uuid[], array[]::uuid[],
    '70000000-0000-4000-8000-000000000008', 20, 2
  )$$,
  'P0001', 'TEST_INJECTED_FAILURE',
  'converted Plan marker failure aborts lifecycle'
);
drop trigger test_fail_conversion_marker on public.hangout_sessions;
select is((select count(*) from public.plans), (select plans from test_failure_baseline), 'marker failure leaves no Plan');
select is((select count(*) from public.plan_participants), (select participants from test_failure_baseline), 'marker failure leaves no participants');
select is((select count(*) from public.conversations), (select conversations from test_failure_baseline), 'marker failure leaves no Plan Chat');
select is(
  (select converted_plan_id from public.hangout_sessions where id = '70000000-0000-4000-8000-000000000008'),
  null::uuid,
  'marker failure leaves no stale converted_plan_id'
);
select is(
  (select status from public.hangout_sessions where id = '70000000-0000-4000-8000-000000000008'),
  'active',
  'marker failure preserves the convertible UpFor state'
);
select is((select count(*) from public.jobs), (select jobs from test_failure_baseline), 'marker failure queues no side effect');
select is((select count(*) from public.idempotency_keys), (select idempotency from test_failure_baseline), 'marker failure leaves no stuck idempotency row');

create trigger test_fail_jobs
before insert on public.jobs
for each row execute function pg_temp.fail_plan_lifecycle_stage();
select throws_ok(
  $$select * from public.create_plan_lifecycle(
    '50000000-0000-4000-8000-000000000005',
    'a0000000-0000-4000-8000-000000000033',
    'Injected job failure', null, 'quick', null, null, 'UTC', null,
    'decide_in_chat', null, null, 'coffee',
    array['60000000-0000-4000-8000-000000000006']::uuid[], array[]::uuid[], null, 20, 2
  )$$,
  'P0001', 'TEST_INJECTED_FAILURE',
  'transaction-required job failure aborts lifecycle'
);
drop trigger test_fail_jobs on public.jobs;
select is((select count(*) from public.plans), (select plans from test_failure_baseline), 'job failure leaves no Plan');
select is((select count(*) from public.plan_participants), (select participants from test_failure_baseline), 'job failure leaves no participants');
select is((select count(*) from public.conversations), (select conversations from test_failure_baseline), 'job failure leaves no Plan Chat');
select is((select count(*) from public.jobs), (select jobs from test_failure_baseline), 'job failure leaves no side-effect row');
select is((select count(*) from public.idempotency_keys), (select idempotency from test_failure_baseline), 'job failure leaves no lifecycle idempotency evidence');

select * from finish();
rollback;
