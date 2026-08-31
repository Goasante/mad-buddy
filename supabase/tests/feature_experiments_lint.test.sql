begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into auth.users (id, aud, role, email, encrypted_password, created_at, updated_at)
values (
  '73000000-0000-4000-8000-000000000010',
  'authenticated',
  'authenticated',
  'experiment-lint@test.invalid',
  'x',
  now(),
  now()
);

insert into public.experiments (
  id, key, name, description, hypothesis, status, allocation_percentage,
  audience, target_platforms, target_plans, starts_at, ends_at,
  primary_metric, created_by
) values
  (
    '73000000-0000-4000-8000-000000000001',
    'lint_schedule_start', 'Scheduled start', 'Starts through the scheduler.',
    'The scheduler starts eligible experiments.', 'draft', 100,
    'all_eligible', array['web'], array['free']::public.subscription_plan[],
    now() - interval '1 hour', now() + interval '1 hour',
    'activation', '73000000-0000-4000-8000-000000000010'
  ),
  (
    '73000000-0000-4000-8000-000000000002',
    'lint_schedule_finish', 'Scheduled finish', 'Completes through the scheduler.',
    'The scheduler completes expired experiments.', 'draft', 100,
    'all_eligible', array['web'], array['free']::public.subscription_plan[],
    now() - interval '2 hours', now() - interval '1 hour',
    'activation', '73000000-0000-4000-8000-000000000010'
  ),
  (
    '73000000-0000-4000-8000-000000000003',
    'lint_assignment', 'Assignment check', 'Exercises assignment and exposure.',
    'Eligible users receive one durable assignment.', 'draft', 100,
    'all_eligible', array['web'], array['free']::public.subscription_plan[],
    now() - interval '1 hour', now() + interval '1 hour',
    'activation', '73000000-0000-4000-8000-000000000010'
  );

insert into public.experiment_variants (
  experiment_id, key, name, weight_basis_points, is_control
)
select experiment_id, variant_key, variant_name, weight, control
from (
  values
    ('73000000-0000-4000-8000-000000000001'::uuid, 'control', 'Control', 5000, true),
    ('73000000-0000-4000-8000-000000000001'::uuid, 'variant_a', 'Variant', 5000, false),
    ('73000000-0000-4000-8000-000000000002'::uuid, 'control', 'Control', 5000, true),
    ('73000000-0000-4000-8000-000000000002'::uuid, 'variant_a', 'Variant', 5000, false),
    ('73000000-0000-4000-8000-000000000003'::uuid, 'control', 'Control', 5000, true),
    ('73000000-0000-4000-8000-000000000003'::uuid, 'variant_a', 'Variant', 5000, false)
) as fixtures(experiment_id, variant_key, variant_name, weight, control);

update public.experiments
set status = case
  when id in (
    '73000000-0000-4000-8000-000000000001',
    '73000000-0000-4000-8000-000000000002'
  ) then 'scheduled'
  else 'running'
end
where id in (
  '73000000-0000-4000-8000-000000000001',
  '73000000-0000-4000-8000-000000000002',
  '73000000-0000-4000-8000-000000000003'
);

set local role service_role;
select is(
  public.process_experiment_schedules(),
  2,
  'scheduler transitions both due experiments without an audit target type error'
);
reset role;

select is(
  (select status from public.experiments where id = '73000000-0000-4000-8000-000000000001'),
  'running',
  'scheduled start becomes running'
);
select is(
  (select status from public.experiments where id = '73000000-0000-4000-8000-000000000002'),
  'completed',
  'expired scheduled experiment becomes completed'
);
select is(
  (select count(*) from public.admin_audit_events
   where target_id in (
     '73000000-0000-4000-8000-000000000001',
     '73000000-0000-4000-8000-000000000002'
   ) and target_type = 'experiment'),
  2::bigint,
  'scheduler writes UUID audit targets for both transitions'
);

set local role service_role;
create temp table lint_assignment_result on commit drop as
select * from public.resolve_experiment_assignment(
  'lint_assignment',
  '73000000-0000-4000-8000-000000000010',
  'web'
);
reset role;

select is((select count(*) from lint_assignment_result), 1::bigint, 'assignment resolves without ambiguous is_control');
select ok((select is_control is not null from lint_assignment_result), 'assignment returns the canonical control flag');
select is(
  (select count(*) from public.experiment_assignments
   where experiment_id = '73000000-0000-4000-8000-000000000003'
     and user_id = '73000000-0000-4000-8000-000000000010'),
  1::bigint,
  'assignment evidence is persisted once'
);

set local role service_role;
create temp table lint_first_exposure on commit drop as
select * from public.record_experiment_exposure(
  'lint_assignment',
  '73000000-0000-4000-8000-000000000010',
  'web'
);
create temp table lint_repeat_exposure on commit drop as
select * from public.record_experiment_exposure(
  'lint_assignment',
  '73000000-0000-4000-8000-000000000010',
  'web'
);
reset role;

select is((select first_exposure from lint_first_exposure), true, 'first exposure is recorded');
select is((select first_exposure from lint_repeat_exposure), false, 'duplicate exposure is idempotent');
select is(
  (select count(*) from public.experiment_exposures
   where experiment_id = '73000000-0000-4000-8000-000000000003'
     and user_id = '73000000-0000-4000-8000-000000000010'),
  1::bigint,
  'exposure evidence remains unique'
);
select is(
  (select count(*) from public.domain_events
   where event_type = 'experiment_exposed'
     and actor_id = '73000000-0000-4000-8000-000000000010'),
  1::bigint,
  'first exposure records one deduplicated product event'
);
select is(
  public.current_experiment_plan(
    '73000000-0000-4000-8000-000000000010',
    now()
  ),
  'free'::public.subscription_plan,
  'plan resolution uses the explicit free enum fallback'
);
select is(
  public.feature_flag_enabled_for_subject(
    null,
    '73000000-0000-4000-8000-000000000010',
    'free'::public.subscription_plan,
    'desktop',
    now()
  ),
  false,
  'unknown platforms fail closed'
);

select is(
  bool_and(not has_function_privilege('anon', p.oid, 'execute')),
  true,
  'anon cannot execute experiment control functions'
)
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.proname in (
    'create_experiment_definition',
    'record_product_event',
    'process_experiment_schedules',
    'experiment_structure_guard',
    'feature_flag_enabled_for_subject',
    'current_experiment_plan',
    'resolve_experiment_assignment',
    'record_experiment_exposure'
  );
select is(
  bool_and(not has_function_privilege('authenticated', p.oid, 'execute')),
  true,
  'authenticated cannot execute experiment control functions'
)
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.proname in (
    'create_experiment_definition',
    'record_product_event',
    'process_experiment_schedules',
    'experiment_structure_guard',
    'feature_flag_enabled_for_subject',
    'current_experiment_plan',
    'resolve_experiment_assignment',
    'record_experiment_exposure'
  );
select is(
  bool_and(has_function_privilege('service_role', p.oid, 'execute')),
  true,
  'service_role retains experiment control execution'
)
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.proname in (
    'create_experiment_definition',
    'record_product_event',
    'process_experiment_schedules',
    'experiment_structure_guard',
    'feature_flag_enabled_for_subject',
    'current_experiment_plan',
    'resolve_experiment_assignment',
    'record_experiment_exposure'
  );

select is(
  bool_and(c.relrowsecurity),
  true,
  'RLS remains enabled on every experiment data table'
)
from pg_class c
where c.oid in (
  'public.experiments'::regclass,
  'public.experiment_variants'::regclass,
  'public.experiment_testers'::regclass,
  'public.experiment_assignments'::regclass,
  'public.experiment_exposures'::regclass
);

select * from finish();
rollback;
