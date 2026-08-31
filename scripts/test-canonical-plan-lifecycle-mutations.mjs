import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";

const CONTAINER = process.env.MAD_BUDDY_TEST_DB_CONTAINER ?? "supabase_db_mad-buddy";
if (CONTAINER !== "supabase_db_mad-buddy") {
  throw new Error("Refusing to mutate any database except the disposable local Supabase container.");
}

const canonical = await readFile(
  new URL("../supabase/migrations/20260814200000_canonical_plan_lifecycle.sql", import.meta.url),
  "utf8",
);

const ids = {
  base: "72000000-0000-4000-8000-000000000001",
  friend: "72000000-0000-4000-8000-000000000002",
  concurrency: "72000000-0000-4000-8000-000000000003",
  retry: "72000000-0000-4000-8000-000000000004",
  conversion: "72000000-0000-4000-8000-000000000005",
  reentry: "72000000-0000-4000-8000-000000000006",
};
const allIds = Object.values(ids);
const idArray = `array[${allIds.map((id) => `'${id}'::uuid`).join(",")}]`;

function runSql(sql) {
  return new Promise((resolve) => {
    const child = spawn(
      "docker",
      ["exec", "-i", CONTAINER, "psql", "-X", "-qAt", "-F", "|", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("close", (code) => resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() }));
    child.stdin.end(sql);
  });
}

async function mustRun(sql, label) {
  const result = await runSql(sql);
  if (result.code !== 0) throw new Error(`${label} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function createSql(actor, request, title, source = null) {
  return `
set role service_role;
select plan_id::text, conversation_id::text, created::text
from public.create_plan_lifecycle(
  '${actor}', '${request}', '${title}', null, 'quick', null, null, 'UTC', null,
  'decide_in_chat', null, null, 'coffee', array[]::uuid[], array[]::uuid[],
  ${source ? `'${source}'::uuid` : "null::uuid"}, 1, 5
);`;
}

async function restoreCanonical() {
  await mustRun(canonical, "canonical migration restore");
}

async function cleanup() {
  await mustRun(`
begin;
alter table public.domain_events disable trigger domain_events_immutable;
delete from public.domain_events where actor_id = any(${idArray});
delete from public.messages where conversation_id in (
  select id from public.conversations where created_by = any(${idArray})
);
delete from public.conversation_members where conversation_id in (
  select id from public.conversations where created_by = any(${idArray})
);
delete from public.conversations where created_by = any(${idArray});
delete from public.jobs where payload ->> 'actorId' = any(array[${allIds.map((id) => `'${id}'`).join(",")}]);
delete from public.idempotency_keys where user_id = any(${idArray}) and scope = 'plans.create';
delete from auth.users where id = any(${idArray});
alter table public.domain_events enable trigger domain_events_immutable;
commit;`, "mutation fixture cleanup");
}

async function seed() {
  await cleanup();
  await mustRun(`
insert into auth.users (id, aud, role, email, encrypted_password, created_at, updated_at)
select id, 'authenticated', 'authenticated', 'mutation-' || row_number() over () || '@test.invalid', 'x', now(), now()
from unnest(${idArray}) as id;
insert into public.friendships (user_one_id, user_two_id) values
  ('${ids.base}', '${ids.friend}'),
  ('${ids.friend}', '${ids.conversion}'),
  ('${ids.friend}', '${ids.reentry}');`, "mutation fixture seed");
}

async function schemaAndPermissionMutations() {
  const source = "72100000-0000-4000-8000-000000000001";
  const a = await mustRun(`
begin;
insert into public.hangout_sessions (id, owner_id, activity_type, ends_at, status)
values ('${source}', '${ids.base}', 'chill', now() + interval '1 hour', 'active');
drop index public.plans_source_hangout_unique;
insert into public.plans (creator_id, title, plan_type, visibility_type, status, timezone, max_participants, place_type, category, source_hangout_id)
values
  ('${ids.base}', 'MUT-A-1', 'quick', 'invited', 'inviting', 'UTC', 5, 'decide_in_chat', 'coffee', '${source}'),
  ('${ids.base}', 'MUT-A-2', 'quick', 'invited', 'inviting', 'UTC', 5, 'decide_in_chat', 'coffee', '${source}');
select count(*) from public.plans where source_hangout_id = '${source}';
rollback;`, "source uniqueness mutation");
  assert(a === "2", "Mutation A did not demonstrate duplicate source mappings.");
  console.log("BITES A source_hangout uniqueness removal");

  const b = await mustRun(`
begin;
insert into public.plans (id, creator_id, title, plan_type, visibility_type, status, timezone, max_participants, place_type, category)
values ('72100000-0000-4000-8000-000000000002', '${ids.base}', 'MUT-B', 'quick', 'invited', 'inviting', 'UTC', 5, 'decide_in_chat', 'coffee');
drop index public.hangout_sessions_converted_plan_unique;
insert into public.hangout_sessions (id, owner_id, activity_type, ends_at, status, converted_plan_id)
values
 ('72100000-0000-4000-8000-000000000003', '${ids.base}', 'chill', now() + interval '1 hour', 'converted_to_plan', '72100000-0000-4000-8000-000000000002'),
 ('72100000-0000-4000-8000-000000000004', '${ids.base}', 'chill', now() + interval '1 hour', 'converted_to_plan', '72100000-0000-4000-8000-000000000002');
select count(*) from public.hangout_sessions where converted_plan_id = '72100000-0000-4000-8000-000000000002';
rollback;`, "converted Plan uniqueness mutation");
  assert(b === "2", "Mutation B did not demonstrate duplicate converted Plan mappings.");
  console.log("BITES B converted_plan uniqueness removal");

  const c = await mustRun(`
begin;
grant execute on function public.create_plan_lifecycle(uuid,text,text,text,text,timestamptz,timestamptz,text,timestamptz,text,text,integer,text,uuid[],uuid[],uuid,integer,integer) to authenticated;
select has_function_privilege('authenticated', 'public.create_plan_lifecycle(uuid,text,text,text,text,timestamp with time zone,timestamp with time zone,text,timestamp with time zone,text,text,integer,text,uuid[],uuid[],uuid,integer,integer)', 'execute');
rollback;`, "authenticated permission mutation");
  assert(c === "t", "Mutation C did not expose the forbidden browser grant.");
  console.log("BITES C authenticated RPC grant");

  const plan = "72100000-0000-4000-8000-000000000005";
  const g = await mustRun(`
begin;
insert into public.plans (id, creator_id, title, plan_type, visibility_type, status, timezone, max_participants, place_type, category)
values ('${plan}', '${ids.base}', 'MUT-G', 'quick', 'invited', 'inviting', 'UTC', 5, 'decide_in_chat', 'coffee');
drop index public.conversations_context_unique;
insert into public.conversations (conversation_type, created_by, context_type, context_id, status)
values
 ('plan', '${ids.base}', 'plan', '${plan}', 'active'),
 ('plan', '${ids.base}', 'plan', '${plan}', 'active');
select count(*) from public.conversations where context_type = 'plan' and context_id = '${plan}';
rollback;`, "Plan conversation uniqueness mutation");
  assert(g === "2", "Mutation G did not demonstrate duplicate Plan conversations.");
  console.log("BITES G Plan context conversation uniqueness removal");
}

async function chatEligibilityMutations() {
  for (const [label, status] of [["E", "invited"], ["F", "not_going"]]) {
    const mutated = canonical.replaceAll(
      "pp.rsvp_status in ('going', 'maybe')",
      `pp.rsvp_status in ('going', 'maybe', '${status}')`,
    );
    assert(mutated !== canonical, `Mutation ${label} could not alter the reconciler.`);
    const plan = label === "E" ? "72200000-0000-4000-8000-000000000001" : "72200000-0000-4000-8000-000000000002";
    const output = await mustRun(`
begin;
${mutated}
insert into public.plans (id, creator_id, title, plan_type, visibility_type, status, timezone, max_participants, place_type, category)
values ('${plan}', '${ids.base}', 'MUT-${label}', 'quick', 'invited', 'inviting', 'UTC', 5, 'decide_in_chat', 'coffee');
insert into public.plan_participants (plan_id, user_id, role, rsvp_status, invited_by)
values
 ('${plan}', '${ids.base}', 'host', 'going', '${ids.base}'),
 ('${plan}', '${ids.friend}', 'participant', '${status}', '${ids.base}');
select public.reconcile_plan_conversation_members('${plan}');
select count(*) from public.conversation_members cm
join public.conversations c on c.id = cm.conversation_id
where c.context_type = 'plan' and c.context_id = '${plan}' and cm.user_id = '${ids.friend}' and cm.status = 'joined';
rollback;`, `chat eligibility mutation ${label}`);
    const joined = output.split(/\r?\n/).at(-1);
    assert(joined === "1", `Mutation ${label} did not wrongly join the ${status} participant.`);
    console.log(`BITES ${label} ${status} participant wrongly joined`);
  }
}

async function activeLimitMutation() {
  const needle = "  perform pg_advisory_xact_lock(hashtextextended('plans:actor:' || p_actor_id::text, 0));";
  const mutated = canonical.replace(needle, "  -- MUTATION: actor-wide active-limit lock removed");
  assert(mutated !== canonical, "Mutation D could not remove the actor lock.");
  await mustRun(mutated, "active-limit lock mutation apply");
  try {
    await mustRun(`
create or replace function public.test_delay_mutated_plan_insert() returns trigger language plpgsql as $$
begin perform pg_sleep(1); return new; end; $$;
create trigger test_delay_mutated_plan_insert before insert on public.plans
for each row when (new.title like 'MUT-D%') execute function public.test_delay_mutated_plan_insert();`, "active-limit race trigger");
    const calls = [
      createSql(ids.concurrency, "72300000-0000-4000-8000-000000000001", "MUT-D-1"),
      createSql(ids.concurrency, "72300000-0000-4000-8000-000000000002", "MUT-D-2"),
    ];
    const results = await Promise.all(calls.map(runSql));
    const count = await mustRun(`select count(*) from public.plans where creator_id = '${ids.concurrency}';`, "active-limit mutation count");
    assert(results.every((result) => result.code === 0) && count === "2", "Mutation D was not caught by the genuine concurrent active-limit test.");
    console.log("BITES D active-plan concurrency lock removal");
  } finally {
    await mustRun(`drop trigger if exists test_delay_mutated_plan_insert on public.plans; drop function if exists public.test_delay_mutated_plan_insert();`, "active-limit test trigger cleanup");
    await restoreCanonical();
  }
}

async function idempotencyMutation() {
  const needle = "    and ik.key = p_request_key\n  for update;";
  const mutated = canonical.replace(needle, "    and ik.key = p_request_key || ':broken'\n  for update;");
  assert(mutated !== canonical, "Mutation H could not alter the idempotency lookup.");
  await mustRun(mutated, "idempotency mutation apply");
  try {
    const sql = createSql(ids.retry, "72400000-0000-4000-8000-000000000001", "MUT-H");
    const first = await runSql(sql);
    const second = await runSql(sql);
    assert(first.code === 0 && second.code !== 0, "Mutation H did not break stable request retry behavior.");
    console.log("BITES H request idempotency lookup regression");
  } finally {
    await restoreCanonical();
  }
}

async function conversionMarkerMutation() {
  const pattern = /  if p_source_hangout_id is not null then\r?\n    update public\.hangout_sessions[\s\S]*?  end if;\r?\n\r?\n  -- Durable after-commit work\./;
  const mutated = canonical.replace(pattern, "  if p_source_hangout_id is not null then\n    null; -- MUTATION: conversion marker omitted\n  end if;\n\n  -- Durable after-commit work.");
  assert(mutated !== canonical, "Mutation I could not remove the conversion marker update.");
  await mustRun(mutated, "conversion marker mutation apply");
  const source = "72500000-0000-4000-8000-000000000001";
  try {
    await mustRun(`
insert into public.hangout_sessions (id, owner_id, activity_type, ends_at, status)
values ('${source}', '${ids.conversion}', 'chill', now() + interval '1 hour', 'active');
insert into public.hangout_requests (hangout_session_id, requester_id, status, responded_at)
values ('${source}', '${ids.friend}', 'accepted', now());`, "conversion marker fixture");
    const created = await runSql(createSql(ids.conversion, "72500000-0000-4000-8000-000000000002", "MUT-I", source));
    assert(created.code === 0, "Mutation I fixture should create a source-linked Plan.");
    const mapping = await mustRun(`select converted_plan_id is null from public.hangout_sessions where id = '${source}';`, "conversion marker mutation verification");
    assert(mapping === "t", "Mutation I did not expose the missing atomic conversion marker.");
    console.log("BITES I conversion marker omitted from lifecycle");
  } finally {
    await restoreCanonical();
  }
}

async function removedMemberReentryMutation() {
  const needle = "      where public.plan_participants.rsvp_status = 'removed'";
  const mutated = canonical.replace(needle, "      where false -- MUTATION: removed participant cannot be reactivated");
  assert(mutated !== canonical, "Mutation J could not break removed-member re-entry.");
  await mustRun(mutated, "removed-member re-entry mutation apply");
  const plan = "72600000-0000-4000-8000-000000000001";
  try {
    await mustRun(`
insert into public.plans (id, creator_id, title, plan_type, visibility_type, status, timezone, max_participants, place_type, category)
values ('${plan}', '${ids.reentry}', 'MUT-J', 'quick', 'invited', 'inviting', 'UTC', 5, 'decide_in_chat', 'coffee');
insert into public.plan_participants (plan_id, user_id, role, rsvp_status, invited_by)
values
 ('${plan}', '${ids.reentry}', 'host', 'going', '${ids.reentry}'),
 ('${plan}', '${ids.friend}', 'participant', 'removed', '${ids.reentry}');`, "removed-member fixture");
    const output = await mustRun(`set role service_role; select added_count from public.add_plan_participants('${ids.reentry}', '${plan}', array['${ids.friend}'::uuid], 5);`, "removed-member mutation call");
    const status = await mustRun(`select rsvp_status from public.plan_participants where plan_id = '${plan}' and user_id = '${ids.friend}';`, "removed-member mutation state");
    assert(output === "0" && status === "removed", "Mutation J did not expose broken removed-member re-entry.");
    console.log("BITES J removed-member re-entry regression");
  } finally {
    await restoreCanonical();
  }
}

async function main() {
  console.log(`Using disposable local database container: ${CONTAINER}`);
  await restoreCanonical();
  await seed();
  try {
    await schemaAndPermissionMutations();
    await chatEligibilityMutations();
    await activeLimitMutation();
    await idempotencyMutation();
    await conversionMarkerMutation();
    await removedMemberReentryMutation();
  } finally {
    await restoreCanonical();
    await cleanup();
  }
  console.log("All ten canonical Plan mutation checks bit as expected.");
}

main().catch((error) => {
  console.error(`FAIL ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
