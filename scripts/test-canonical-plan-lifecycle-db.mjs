import { spawn } from "node:child_process";

const CONTAINER = process.env.MAD_BUDDY_TEST_DB_CONTAINER ?? "supabase_db_mad-buddy";

if (CONTAINER !== "supabase_db_mad-buddy") {
  throw new Error("Refusing to run against a container other than the disposable local Supabase database.");
}

const ids = {
  retryHost: "71000000-0000-4000-8000-000000000001",
  limitHost: "71000000-0000-4000-8000-000000000002",
  upForHost: "71000000-0000-4000-8000-000000000003",
  capacityHost: "71000000-0000-4000-8000-000000000004",
  friendOne: "71000000-0000-4000-8000-000000000005",
  friendTwo: "71000000-0000-4000-8000-000000000006",
};

const fixtureIds = Object.values(ids);
const fixtureUuidArray = `array[${fixtureIds.map((id) => `'${id}'::uuid`).join(",")}]`;

function runSql(sql) {
  return new Promise((resolve) => {
    const child = spawn(
      "docker",
      [
        "exec",
        "-i",
        CONTAINER,
        "psql",
        "-X",
        "-qAt",
        "-F",
        "|",
        "-v",
        "ON_ERROR_STOP=1",
        "-U",
        "postgres",
        "-d",
        "postgres",
      ],
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
  if (result.code !== 0) {
    throw new Error(`${label} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function createPlanSql({ actor, request, title, invitees = [], initialGoing = [], source = null, maxActive = 10, maxParticipants = 10 }) {
  const inviteeArray = `array[${invitees.map((id) => `'${id}'::uuid`).join(",")}]::uuid[]`;
  const goingArray = `array[${initialGoing.map((id) => `'${id}'::uuid`).join(",")}]::uuid[]`;
  return `
set role service_role;
select plan_id::text, conversation_id::text, created::text
from public.create_plan_lifecycle(
  '${actor}'::uuid,
  '${request}',
  '${title.replaceAll("'", "''")}',
  null,
  'quick',
  null,
  null,
  'UTC',
  null,
  'decide_in_chat',
  null,
  null,
  'coffee',
  ${inviteeArray},
  ${goingArray},
  ${source ? `'${source}'::uuid` : "null::uuid"},
  ${maxActive},
  ${maxParticipants}
);
`;
}

async function cleanup() {
  await mustRun(`
begin;
alter table public.domain_events disable trigger domain_events_immutable;
delete from public.domain_events where actor_id = any(${fixtureUuidArray});
delete from public.messages
where conversation_id in (
  select id from public.conversations
  where context_type = 'plan' and created_by = any(${fixtureUuidArray})
);
delete from public.conversation_members
where conversation_id in (
  select id from public.conversations
  where context_type = 'plan' and created_by = any(${fixtureUuidArray})
);
delete from public.conversations
where context_type = 'plan' and created_by = any(${fixtureUuidArray});
delete from public.jobs where payload ->> 'actorId' = any(array[${fixtureIds.map((id) => `'${id}'`).join(",")}]);
delete from public.idempotency_keys where user_id = any(${fixtureUuidArray}) and scope = 'plans.create';
delete from auth.users where id = any(${fixtureUuidArray});
alter table public.domain_events enable trigger domain_events_immutable;
commit;
`, "fixture cleanup");
}

async function seed() {
  await cleanup();
  await mustRun(`
insert into auth.users (id, aud, role, email, encrypted_password, created_at, updated_at)
select id, 'authenticated', 'authenticated', 'db-gate-' || row_number() over () || '@test.invalid', 'x', now(), now()
from unnest(${fixtureUuidArray}) as id;

insert into public.friendships (user_one_id, user_two_id)
values
  ('${ids.upForHost}', '${ids.friendOne}'),
  ('${ids.capacityHost}', '${ids.friendOne}'),
  ('${ids.capacityHost}', '${ids.friendTwo}');
`, "fixture seed");
}

async function testDuplicateRequestConcurrency() {
  const sql = createPlanSql({
    actor: ids.retryHost,
    request: "71100000-0000-4000-8000-000000000001",
    title: "CONC duplicate request",
    maxActive: 1,
  });
  const results = await Promise.all([runSql(sql), runSql(sql)]);
  assert(results.every((result) => result.code === 0), "Both duplicate request calls must complete successfully.");
  const rows = results.map((result) => result.stdout.split("|")).filter((row) => row.length === 3);
  assert(rows.length === 2, "Both duplicate request calls must return lifecycle rows.");
  assert(rows[0][0] === rows[1][0] && rows[0][1] === rows[1][1], "Concurrent retries must return the same Plan and conversation.");
  assert(rows.filter((row) => row[2] === "true").length === 1, "Exactly one concurrent retry may create the lifecycle.");
  const counts = await mustRun(`
select count(*),
       count(distinct c.id),
       count(distinct pp.id)
from public.plans p
left join public.conversations c on c.context_type = 'plan' and c.context_id = p.id
left join public.plan_participants pp on pp.plan_id = p.id
where p.creator_id = '${ids.retryHost}';
`, "duplicate request verification");
  assert(counts === "1|1|1", `Expected one Plan/chat/host participant, got ${counts}.`);
  console.log("PASS concurrent duplicate request-key idempotency");
}

async function testActiveLimitConcurrency() {
  const calls = [
    createPlanSql({ actor: ids.limitHost, request: "71200000-0000-4000-8000-000000000001", title: "CONC active slot A", maxActive: 1 }),
    createPlanSql({ actor: ids.limitHost, request: "71200000-0000-4000-8000-000000000002", title: "CONC active slot B", maxActive: 1 }),
  ];
  const results = await Promise.all(calls.map(runSql));
  assert(results.filter((result) => result.code === 0).length === 1, "Exactly one distinct request may take the final active Plan slot.");
  const failed = results.find((result) => result.code !== 0);
  assert(failed?.stderr.includes("PLAN_ACTIVE_LIMIT_REACHED"), "The losing concurrent request must fail with PLAN_ACTIVE_LIMIT_REACHED.");
  const counts = await mustRun(`select count(*) from public.plans where creator_id = '${ids.limitHost}';`, "active limit verification");
  assert(counts === "1", `Active Plan race created ${counts} Plans instead of one.`);
  console.log("PASS concurrent active-plan limit");
}

async function testUpForConcurrency() {
  const hangout = "71300000-0000-4000-8000-000000000001";
  await mustRun(`
insert into public.hangout_sessions (id, owner_id, activity_type, ends_at, max_participants, status)
values ('${hangout}', '${ids.upForHost}', 'chill', now() + interval '2 hours', 5, 'active');
insert into public.hangout_requests (hangout_session_id, requester_id, status, responded_at)
values ('${hangout}', '${ids.friendOne}', 'accepted', now());
`, "UpFor fixture");
  const calls = [
    createPlanSql({ actor: ids.upForHost, request: "71300000-0000-4000-8000-000000000002", title: "CONC UpFor A", source: hangout, maxActive: 10, maxParticipants: 5 }),
    createPlanSql({ actor: ids.upForHost, request: "71300000-0000-4000-8000-000000000003", title: "CONC UpFor B", source: hangout, maxActive: 10, maxParticipants: 5 }),
  ];
  const results = await Promise.all(calls.map(runSql));
  assert(results.every((result) => result.code === 0), "Both simultaneous UpFor conversions must resolve safely.");
  const planIds = results.map((result) => result.stdout.split("|")[0]);
  assert(planIds[0] && planIds[0] === planIds[1], "Both UpFor conversions must resolve to the same Plan.");
  const mapping = await mustRun(`
select count(*),
       count(*) filter (where p.source_hangout_id = hs.id and hs.converted_plan_id = p.id),
       bool_and(hs.status = 'converted_to_plan')
from public.hangout_sessions hs
join public.plans p on p.id = hs.converted_plan_id
where hs.id = '${hangout}';
`, "UpFor conversion verification");
  assert(mapping === "1|1|t", `UpFor mapping is not canonical: ${mapping}.`);
  console.log("PASS simultaneous UpFor-to-Plan conversion");
}

async function testCapacityAndChatConcurrency() {
  const create = await mustRun(createPlanSql({
    actor: ids.capacityHost,
    request: "71400000-0000-4000-8000-000000000001",
    title: "CONC capacity",
    invitees: [ids.friendOne, ids.friendTwo],
    maxParticipants: 3,
  }), "capacity Plan creation");
  const [planId, conversationId] = create.split("|");
  await mustRun(`update public.plans set max_participants = 2 where id = '${planId}';`, "capacity fixture adjustment");
  const rsvpSql = (actor) => `
set role service_role;
select rsvp_status, conversation_id::text
from public.set_plan_participant_rsvp('${actor}', '${planId}', 'going');
`;
  const results = await Promise.all([runSql(rsvpSql(ids.friendOne)), runSql(rsvpSql(ids.friendTwo))]);
  assert(results.every((result) => result.code === 0), "Both capacity-race RSVP calls must resolve without partial failure.");
  const statuses = results.map((result) => result.stdout.split("|")[0]).sort();
  assert(statuses.join(",") === "going,waitlisted", `Expected one Going and one waitlisted result, got ${statuses.join(",")}.`);
  const state = await mustRun(`
select
  count(*) filter (where pp.rsvp_status = 'going'),
  count(*) filter (where pp.rsvp_status = 'waitlisted'),
  count(*) filter (where cm.status = 'joined' and pp.rsvp_status = 'going'),
  count(*) filter (where cm.status = 'joined' and pp.rsvp_status = 'waitlisted'),
  count(distinct cm.id)
from public.plan_participants pp
left join public.conversation_members cm
  on cm.conversation_id = '${conversationId}' and cm.user_id = pp.user_id
where pp.plan_id = '${planId}';
`, "capacity/chat verification");
  assert(state === "2|1|2|0|2", `Capacity or Plan Chat membership was not atomic: ${state}.`);
  console.log("PASS participant capacity/waitlist race and atomic Plan Chat membership");
}

async function testBrowserRoleDenial() {
  const result = await runSql(`
set role authenticated;
select * from public.create_plan_lifecycle(
  '${ids.retryHost}', '71500000-0000-4000-8000-000000000001', 'Denied', null,
  'quick', null, null, 'UTC', null, 'decide_in_chat', null, null, 'coffee',
  array[]::uuid[], array[]::uuid[], null, 10, 10
);
`);
  assert(result.code !== 0 && result.stderr.includes("permission denied for function create_plan_lifecycle"), "authenticated must receive an actual RPC permission denial.");
  console.log("PASS actual browser-role RPC denial");
}

async function main() {
  console.log(`Using disposable local database container: ${CONTAINER}`);
  await seed();
  try {
    await testDuplicateRequestConcurrency();
    await testActiveLimitConcurrency();
    await testUpForConcurrency();
    await testCapacityAndChatConcurrency();
    await testBrowserRoleDenial();
  } finally {
    await cleanup();
  }
  console.log("All canonical Plan real-concurrency checks passed.");
}

main().catch((error) => {
  console.error(`FAIL ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
