/**
 * MB-GOD-058 — RLS behaviour across every relationship state, before and after.
 *
 * The recursion fails CLOSED, so "no rows returned" is the symptom of the BUG
 * as well as the correct answer for an outsider. A test that only asserted
 * "outsiders see nothing" would therefore pass identically on the broken
 * schema. This distinguishes the two by asserting the POSITIVE cases as well:
 * a joined member MUST see the conversation, its members, and its messages.
 * Those are exactly the assertions that fail today.
 *
 * Run with --before to capture the pre-migration baseline, --after to compare.
 *
 * The probe runs inside Postgres as each persona (set_config on
 * request.jwt.claims + role), because that is the only way to exercise a policy
 * as written. Going through PostgREST would add its own error translation
 * between the policy and the assertion.
 *
 * FIXTURE DISCIPLINE: every fixture is created here, asserted on, and dropped
 * in the same run. `profiles_username_format` rejects hyphens.
 */
import { execFileSync } from "node:child_process";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";

const CONTAINER = "supabase_db_mad-buddy";
const OUT = "C:/mb-god/.hardening/rls";
mkdirSync(OUT, { recursive: true });
const MODE = process.argv.includes("--after") ? "after" : "before";

function psql(sql) {
  return execFileSync(
    "docker",
    ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-q", "-A", "-t", "-F", "|"],
    { input: sql, encoding: "utf8", maxBuffer: 1 << 24 }
  );
}

/**
 * Build the fixture, probe every persona against every table, tear down.
 *
 * Personas:
 *   member    — joined. MUST see the conversation and its messages.
 *   outsider  — a real account with no relationship. MUST see nothing.
 *   removed   — was a member, status 'removed'. Must NOT see conversation
 *               content, but MUST still see their own membership row (that arm
 *               of the policy is what makes an invitation visible).
 *   traveller — owns a Safe Arrival session.
 *   contact   — named as a safe-arrival contact on that session.
 *   stranger  — no relationship to the safe-arrival session.
 *   anon      — signed out. MUST see nothing, anywhere.
 */
const PROBE = `
create table if not exists public.mb_rls_probe (persona text, tbl text, outcome text, n integer);
truncate public.mb_rls_probe;

do $$
declare
  v_member uuid; v_outsider uuid; v_removed uuid;
  v_traveller uuid; v_contact uuid; v_stranger uuid;
  v_convo uuid; v_session uuid; v_plan uuid; v_circle uuid;
  v_stamp text := to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS');
  r record; v_n integer; v_msg text; v_out text[] := array[]::text[];
begin
  -- ---------- fixture ----------
  for r in select unnest(array['member','outsider','removed','traveller','contact','stranger']) as tag loop
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                            email_confirmed_at, created_at, updated_at)
    values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated',
            'authenticated', 'rls' || r.tag || v_stamp || '@local.test', crypt('x', gen_salt('bf')),
            now(), now(), now());
  end loop;

  select id into v_member    from auth.users where email = 'rlsmember'    || v_stamp || '@local.test';
  select id into v_outsider  from auth.users where email = 'rlsoutsider'  || v_stamp || '@local.test';
  select id into v_removed   from auth.users where email = 'rlsremoved'   || v_stamp || '@local.test';
  select id into v_traveller from auth.users where email = 'rlstraveller' || v_stamp || '@local.test';
  select id into v_contact   from auth.users where email = 'rlscontact'   || v_stamp || '@local.test';
  select id into v_stranger  from auth.users where email = 'rlsstranger'  || v_stamp || '@local.test';

  insert into public.profiles (user_id, username, full_name, is_onboarded) values
    (v_member,    'rlsm' || right(v_stamp, 8), 'RLS Member',    true),
    (v_outsider,  'rlso' || right(v_stamp, 8), 'RLS Outsider',  true),
    (v_removed,   'rlsr' || right(v_stamp, 8), 'RLS Removed',   true),
    (v_traveller, 'rlst' || right(v_stamp, 8), 'RLS Traveller', true),
    (v_contact,   'rlsc' || right(v_stamp, 8), 'RLS Contact',   true),
    (v_stranger,  'rlss' || right(v_stamp, 8), 'RLS Stranger',  true);

  insert into public.conversations (conversation_type, created_by, status, direct_key)
  values ('group', v_member, 'active', null)
  returning id into v_convo;

  insert into public.conversation_members (conversation_id, user_id, role, status) values
    (v_convo, v_member,  'owner',  'joined'),
    (v_convo, v_removed, 'member', 'removed');

  insert into public.messages (conversation_id, sender_id, message_type, text_content, client_message_id)
  values (v_convo, v_member, 'text', 'rls fixture message', gen_random_uuid());

  -- destination_label and expected_arrival_at are NOT NULL with no default.
  -- A generic label, never a real place: fixtures must not look like data.
  insert into public.safe_arrival_sessions
    (traveller_id, status, destination_label, expected_arrival_at)
  values (v_traveller, 'active', 'RLS fixture destination', now() + interval '1 hour')
  returning id into v_session;
  insert into public.safe_arrival_contacts (session_id, contact_user_id)
  values (v_session, v_contact);

  /* Plans and Event Circles: the two cycles the audit never recorded. The
     member persona is reused as the participant/joined member and the traveller
     persona as the creator/owner, so the same seven personas exercise all four
     families without inventing more accounts. */
  -- plan_type is NOT NULL with no default; allowed: quick, scheduled, poll.
  -- status is left to its default ('inviting'): 'active' is NOT a valid plan
  -- status, and asserting one would have tested a state plans never occupy.
  insert into public.plans (creator_id, title, plan_type)
  values (v_traveller, 'RLS fixture plan', 'quick')
  returning id into v_plan;

  insert into public.plan_participants (plan_id, user_id, rsvp_status)
  values (v_plan, v_member, 'going');

  insert into public.event_circles (owner_id, name)
  values (v_traveller, 'RLS fixture circle')
  returning id into v_circle;

  insert into public.event_circle_members (event_circle_id, user_id, status)
  values (v_circle, v_member, 'joined');

  /* Results accumulate in an ARRAY, not a temp table. The temp table is owned
     by postgres, but the probe runs with the session role set to authenticated
     -- so writing the result of a probe was itself denied, and the harness
     failed for a reason that had nothing to do with the policies under test. */

  -- ---------- probe ----------
  for r in
    select * from (values
      ('member',    v_member),   ('outsider',  v_outsider), ('removed',   v_removed),
      ('traveller', v_traveller),('contact',   v_contact),  ('stranger',  v_stranger),
      ('anon',      null::uuid)
    ) as t(persona, uid)
  loop
    if r.uid is null then
      perform set_config('request.jwt.claims', null, true);
      perform set_config('role', 'anon', true);
    else
      perform set_config('request.jwt.claims',
        json_build_object('sub', r.uid, 'role', 'authenticated')::text, true);
      perform set_config('role', 'authenticated', true);
    end if;

    -- conversation the member owns
    begin
      execute 'select count(*) from public.conversations where id = $1'
        into v_n using v_convo;
      v_out := v_out || format('ROW|%s|conversations|ok|%s', r.persona, v_n);
    exception when others then
      get stacked diagnostics v_msg = message_text;
      v_out := v_out || format('ROW|%s|conversations|%s|-1', r.persona, left(replace(v_msg, '|', ' '), 40));
    end;

    -- membership rows of that conversation
    begin
      execute 'select count(*) from public.conversation_members where conversation_id = $1'
        into v_n using v_convo;
      v_out := v_out || format('ROW|%s|conversation_members|ok|%s', r.persona, v_n);
    exception when others then
      get stacked diagnostics v_msg = message_text;
      v_out := v_out || format('ROW|%s|conversation_members|%s|-1', r.persona, left(replace(v_msg, '|', ' '), 40));
    end;

    -- messages in it
    begin
      execute 'select count(*) from public.messages where conversation_id = $1'
        into v_n using v_convo;
      v_out := v_out || format('ROW|%s|messages|ok|%s', r.persona, v_n);
    exception when others then
      get stacked diagnostics v_msg = message_text;
      v_out := v_out || format('ROW|%s|messages|%s|-1', r.persona, left(replace(v_msg, '|', ' '), 40));
    end;

    -- the safe arrival session
    begin
      execute 'select count(*) from public.safe_arrival_sessions where id = $1'
        into v_n using v_session;
      v_out := v_out || format('ROW|%s|safe_arrival_sessions|ok|%s', r.persona, v_n);
    exception when others then
      get stacked diagnostics v_msg = message_text;
      v_out := v_out || format('ROW|%s|safe_arrival_sessions|%s|-1', r.persona, left(replace(v_msg, '|', ' '), 40));
    end;

    -- its contacts
    begin
      execute 'select count(*) from public.safe_arrival_contacts where session_id = $1'
        into v_n using v_session;
      v_out := v_out || format('ROW|%s|safe_arrival_contacts|ok|%s', r.persona, v_n);
    exception when others then
      get stacked diagnostics v_msg = message_text;
      v_out := v_out || format('ROW|%s|safe_arrival_contacts|%s|-1', r.persona, left(replace(v_msg, '|', ' '), 40));
    end;

    -- the plan
    begin
      execute 'select count(*) from public.plans where id = $1' into v_n using v_plan;
      v_out := v_out || format('ROW|%s|plans|ok|%s', r.persona, v_n);
    exception when others then
      get stacked diagnostics v_msg = message_text;
      v_out := v_out || format('ROW|%s|plans|%s|-1', r.persona, left(replace(v_msg, '|', ' '), 40));
    end;

    -- its participants
    begin
      execute 'select count(*) from public.plan_participants where plan_id = $1' into v_n using v_plan;
      v_out := v_out || format('ROW|%s|plan_participants|ok|%s', r.persona, v_n);
    exception when others then
      get stacked diagnostics v_msg = message_text;
      v_out := v_out || format('ROW|%s|plan_participants|%s|-1', r.persona, left(replace(v_msg, '|', ' '), 40));
    end;

    -- the event circle
    begin
      execute 'select count(*) from public.event_circles where id = $1' into v_n using v_circle;
      v_out := v_out || format('ROW|%s|event_circles|ok|%s', r.persona, v_n);
    exception when others then
      get stacked diagnostics v_msg = message_text;
      v_out := v_out || format('ROW|%s|event_circles|%s|-1', r.persona, left(replace(v_msg, '|', ' '), 40));
    end;

    -- its members
    begin
      execute 'select count(*) from public.event_circle_members where event_circle_id = $1' into v_n using v_circle;
      v_out := v_out || format('ROW|%s|event_circle_members|ok|%s', r.persona, v_n);
    exception when others then
      get stacked diagnostics v_msg = message_text;
      v_out := v_out || format('ROW|%s|event_circle_members|%s|-1', r.persona, left(replace(v_msg, '|', ' '), 40));
    end;
  end loop;

  perform set_config('request.jwt.claims', null, true);
  perform set_config('role', 'postgres', true);
  reset role;

  foreach v_msg in array v_out loop
    insert into public.mb_rls_probe
    select p[2], p[3], p[4], p[5]::integer
    from (select string_to_array(v_msg, '|') as p) q;
  end loop;

  -- ---------- teardown ----------
  delete from public.event_circle_members where event_circle_id = v_circle;
  delete from public.event_circles where id = v_circle;
  delete from public.plan_participants where plan_id = v_plan;
  delete from public.plans where id = v_plan;
  delete from public.safe_arrival_contacts where session_id = v_session;
  delete from public.safe_arrival_sessions where id = v_session;
  delete from public.messages where conversation_id = v_convo;
  delete from public.conversation_members where conversation_id = v_convo;
  delete from public.conversations where id = v_convo;
  delete from public.activation_milestones
    where user_id in (v_member, v_outsider, v_removed, v_traveller, v_contact, v_stranger);
  delete from public.profiles
    where user_id in (v_member, v_outsider, v_removed, v_traveller, v_contact, v_stranger);

  /* auth.users rows are deliberately LEFT IN PLACE.
     Deleting one cascades an UPDATE that nulls domain_events.actor_id, and
     domain_events is append-only by design -- prevent_domain_event_mutation
     raises, aborting the whole block AFTER the probe has already run. That
     guard is correct and is not weakened for a fixture's convenience.
     The rows left behind are six inert @local.test accounts with no profile,
     no membership and no data; the next line marks them so they are
     recognisable, and they are harmless on a local database. */
  update auth.users
     set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
                              || jsonb_build_object('mb_fixture', 'rls-recursion-matrix')
   where id in (v_member, v_outsider, v_removed, v_traveller, v_contact, v_stranger);
end $$;
`;

let raw;
try {
  /* The DO block writes into a staging table and the SELECT after it returns
     the rows: `raise notice` is swallowed by psql -q on a successful run, so an
     earlier version of this harness reported "no probe rows parsed" on a probe
     that had in fact worked perfectly. */
  raw = psql(`${PROBE}
select 'ROW'||'|'||persona||'|'||tbl||'|'||outcome||'|'||n from public.mb_rls_probe;
drop table public.mb_rls_probe;`);
} catch (e) {
  console.log(`HARNESS ERROR:\n${String(e.stdout ?? "")}\n${String(e.stderr ?? "").slice(0, 1500)}`);
  process.exit(1);
}

const rows = [];
for (const line of raw.split("\n")) {
  const m = line.match(/ROW\|([^|]*)\|([^|]*)\|([^|]*)\|(-?\d+)/);
  if (m) rows.push({ persona: m[1], tbl: m[2], outcome: m[3], n: Number(m[4]) });
}
if (!rows.length) {
  console.log(`HARNESS ERROR: no probe rows parsed.\n${raw.slice(0, 1200)}`);
  process.exit(1);
}

/**
 * The expected matrix. `null` means "no assertion" — used nowhere, kept out
 * deliberately so an unlisted cell is a failure rather than a silent pass.
 *
 * Every cell is the number of rows that persona SHOULD see of the fixture.
 */
const EXPECT = {
  // `member` is also the plan participant and the circle member, so it should
  // see the plan and the circle but NOT the safe-arrival session.
  member:    { conversations: 1, conversation_members: 2, messages: 1, safe_arrival_sessions: 0, safe_arrival_contacts: 0,
               plans: 1, plan_participants: 1, event_circles: 1, event_circle_members: 1 },
  outsider:  { conversations: 0, conversation_members: 0, messages: 0, safe_arrival_sessions: 0, safe_arrival_contacts: 0,
               plans: 0, plan_participants: 0, event_circles: 0, event_circle_members: 0 },
  // A removed member keeps sight of their OWN membership row (the
  // `auth.uid() = user_id` arm) but loses the conversation and its messages.
  removed:   { conversations: 0, conversation_members: 1, messages: 0, safe_arrival_sessions: 0, safe_arrival_contacts: 0,
               plans: 0, plan_participants: 0, event_circles: 0, event_circle_members: 0 },
  // `traveller` doubles as the plan creator and circle owner. As creator it
  // sees BOTH participant rows (its own is absent, so 1: the member).
  traveller: { conversations: 0, conversation_members: 0, messages: 0, safe_arrival_sessions: 1, safe_arrival_contacts: 1,
               plans: 1, plan_participants: 1, event_circles: 1, event_circle_members: 1 },
  contact:   { conversations: 0, conversation_members: 0, messages: 0, safe_arrival_sessions: 1, safe_arrival_contacts: 1,
               plans: 0, plan_participants: 0, event_circles: 0, event_circle_members: 0 },
  stranger:  { conversations: 0, conversation_members: 0, messages: 0, safe_arrival_sessions: 0, safe_arrival_contacts: 0,
               plans: 0, plan_participants: 0, event_circles: 0, event_circle_members: 0 },
  anon:      { conversations: 0, conversation_members: 0, messages: 0, safe_arrival_sessions: 0, safe_arrival_contacts: 0,
               plans: 0, plan_participants: 0, event_circles: 0, event_circle_members: 0 }
};

const TABLES = ["conversations", "conversation_members", "messages", "safe_arrival_sessions",
                "safe_arrival_contacts", "plans", "plan_participants", "event_circles", "event_circle_members"];
const PERSONAS = ["member", "removed", "outsider", "traveller", "contact", "stranger", "anon"];

console.log(`${"=".repeat(130)}\nRLS BEHAVIOUR MATRIX — ${MODE.toUpperCase()} the recursion repair\n${"=".repeat(130)}`);
console.log(`${"persona".padEnd(11)}${TABLES.map((t) => t.slice(0, 11).padStart(13)).join("")}`);

const cell = (persona, tbl) => rows.find((r) => r.persona === persona && r.tbl === tbl);
let pass = 0;
let fail = 0;
const failures = [];

for (const p of PERSONAS) {
  const parts = [];
  for (const t of TABLES) {
    const c = cell(p, t);
    if (!c) { parts.push("MISSING".padStart(13)); fail += 1; failures.push(`${p}/${t}: no result`); continue; }
    const want = EXPECT[p][t];
    if (c.n === -1) {
      parts.push("RECURSE".padStart(13));
      fail += 1;
      failures.push(`${p}/${t}: ${c.outcome}`);
      continue;
    }
    const ok = c.n === want;
    if (ok) pass += 1; else { fail += 1; failures.push(`${p}/${t}: saw ${c.n}, expected ${want}`); }
    parts.push(`${c.n}/${want}${ok ? "" : " XX"}`.padStart(13));
  }
  console.log(`${p.padEnd(11)}${parts.join("")}`);
}

console.log(`\n${pass} cells correct, ${fail} wrong  (shown as seen/expected)`);
if (failures.length) {
  console.log("\nfailures:");
  for (const f of failures) console.log(`  ${f}`);
}

/* THE ASSERTION THAT DISTINGUISHES FIXED FROM FAILS-CLOSED.
   Denial everywhere is what the BUG looks like. A repair is only real if the
   positive cells are populated too. */
const positives = [
  ["member", "conversations"], ["member", "conversation_members"], ["member", "messages"],
  ["removed", "conversation_members"],
  ["traveller", "safe_arrival_sessions"], ["contact", "safe_arrival_sessions"],
  ["traveller", "safe_arrival_contacts"], ["contact", "safe_arrival_contacts"],
  ["member", "plans"], ["traveller", "plans"],
  ["member", "plan_participants"], ["traveller", "plan_participants"],
  ["member", "event_circles"], ["traveller", "event_circles"],
  ["member", "event_circle_members"], ["traveller", "event_circle_members"]
];
const positivesOk = positives.filter(([p, t]) => (cell(p, t)?.n ?? -1) > 0).length;
console.log(`\naccess actually GRANTED where it should be: ${positivesOk}/${positives.length}`);
console.log(positivesOk === positives.length
  ? "RLS is protective: it permits the right people and denies everyone else."
  : "RLS is NOT yet protective — it is denying people who should have access (this is the pre-repair symptom).");

const path = `${OUT}/matrix-${MODE}.json`;
writeFileSync(path, JSON.stringify({ mode: MODE, rows, pass, fail, positivesOk }, null, 2));

if (MODE === "after" && existsSync(`${OUT}/matrix-before.json`)) {
  const before = JSON.parse(readFileSync(`${OUT}/matrix-before.json`, "utf8"));
  console.log(`\n${"-".repeat(130)}\nBEFORE -> AFTER`);
  console.log(`  correct cells:      ${before.pass}  ->  ${pass}`);
  console.log(`  wrong cells:        ${before.fail}  ->  ${fail}`);
  console.log(`  access granted:     ${before.positivesOk}/${positives.length}  ->  ${positivesOk}/${positives.length}`);

  /* Regression guard: no cell may go from denied to visible unless the expected
     matrix says it should be visible. A repair that widened access anywhere
     would show up here even if the totals improved. */
  const widened = [];
  for (const r of rows) {
    const b = before.rows.find((x) => x.persona === r.persona && x.tbl === r.tbl);
    const want = EXPECT[r.persona]?.[r.tbl];
    if (b && r.n > (b.n < 0 ? 0 : b.n) && r.n > want) {
      widened.push(`${r.persona}/${r.tbl}: ${b.n} -> ${r.n} (expected ${want})`);
    }
  }
  console.log(widened.length
    ? `\n  ACCESS WIDENED BEYOND THE POLICY:\n${widened.map((w) => `    ${w}`).join("\n")}`
    : "\n  no persona gained access beyond what the policy specifies.");
}
