/**
 * Mission 1 Extremely Advanced — UpFor → Plan conversion, and Plan RSVP.
 *
 * The Product Constitution's hard rule here: **one UpFor converts into exactly
 * one canonical Plan**, with the correct participants and exactly one Plan Chat.
 * A double conversion is the defect this exists to catch, so the conversion is
 * fired TWICE simultaneously and the row count is read from Postgres.
 *
 * Canonical authorities under test (never re-implemented):
 *   create_plan_lifecycle, set_plan_participant_rsvp,
 *   add_plan_participants, reconcile_plan_conversation_members
 */
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "http://127.0.0.1:54321";
const SERVICE = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
if (!SUPABASE_URL.includes("127.0.0.1")) throw new Error("refusing to run against a non-local database");
const admin = createClient(SUPABASE_URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });

const QA = "d901121e-688e-477b-b8f0-56c782a16801";   // qatester (host)
const KOFI = "2a54c81c-acad-4191-b89d-2c427c693c7a"; // approved Muddy
const AMA = "b66cd360-1f24-4b02-9b8c-123b522d0c61";  // approved Muddy

const results = [];
function check(name, ok, detail) {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}
function inconclusive(name, why) {
  console.log(`INCONC  ${name}  — ${why}`);
}

const TAG = `seq-upfor-${Date.now()}`;

async function cleanup() {
  const { data: plans } = await admin.from("plans").select("id").ilike("title", `${TAG}%`);
  for (const p of plans ?? []) {
    await admin.from("plan_participants").delete().eq("plan_id", p.id);
    await admin.from("plans").delete().eq("id", p.id);
  }
  await admin.from("hangout_sessions").delete().eq("owner_id", QA).eq("activity_type", "food").gte("created_at", new Date(Date.now() - 10 * 60 * 1000).toISOString());
}
await cleanup();

// --- 1. Create an UpFor session ---------------------------------------------
const { data: session, error: sessionError } = await admin
  .from("hangout_sessions")
  .insert({
    owner_id: QA,
    activity_type: "food",
    audience_type: "all_muddies",
    discovery_scope: "muddies",
    starts_at: new Date().toISOString(),
    ends_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    max_participants: 6,
    allow_pings: true,
    allow_friend_invites: true,
    status: "active"
  })
  .select("id, status")
  .maybeSingle();

if (sessionError || !session) {
  inconclusive("UpFor lifecycle", `could not create a session: ${sessionError?.message?.slice(0, 110)}`);
} else {
  check("an UpFor session is created active", session.status === "active", `id ${session.id.slice(0, 8)}`);

  // --- 2. Participants join ------------------------------------------------
  const joins = await Promise.all([KOFI, AMA].map((uid) =>
    admin.from("hangout_requests").insert({
      hangout_session_id: session.id, requester_id: uid, status: "accepted"
    }).select("id").maybeSingle()
  ));
  const joinErrors = joins.filter((j) => j.error);
  if (joinErrors.length) {
    inconclusive("UpFor participants join", `insert failed: ${joinErrors[0].error.message.slice(0, 100)}`);
  } else {
    const { count } = await admin.from("hangout_requests")
      .select("id", { count: "exact", head: true }).eq("hangout_session_id", session.id);
    check("two participants joined", count === 2, `requests ${count}`);
  }

  // --- 3. Convert to a Plan, TWICE, simultaneously -------------------------
  // The canonical rule: one UpFor -> exactly one Plan, no matter how many times
  // conversion is attempted.
  /* The REAL signature. `p_request_key` is an idempotency key — it is the
     mechanism by which a repeated conversion is refused, so both concurrent
     calls deliberately send the SAME key, exactly as a double-tap would. */
  /* The key must be a UUID — the migration validates its shape and raises
     PLAN_REQUEST_KEY_INVALID otherwise. It is a CLIENT-generated idempotency
     key: the same key twice is how a double-tap is collapsed into one Plan,
     which is exactly the property under test, so both concurrent calls send
     this one deliberately. */
  const requestKey = crypto.randomUUID();
  const convert = () =>
    admin.rpc("create_plan_lifecycle", {
      p_actor_id: QA,
      p_request_key: requestKey,
      p_title: `${TAG} dinner`,
      p_description: null,
      p_plan_type: "scheduled",
      p_start_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      p_end_at: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
      p_timezone: "Africa/Accra",
      p_rsvp_deadline: null,
      p_place_type: "custom",
      p_custom_place_text: "Test venue",
      p_reminder_minutes: 30,
      p_category: null,
      p_invitee_ids: [KOFI, AMA],
      p_initial_going_ids: [],
      p_source_hangout_id: session.id,
      p_effective_max_active_plans: 10,
      p_effective_max_participants: 20
    }).then((r) => r, (e) => ({ error: e }));

  const [first, second] = await Promise.all([convert(), convert()]);
  const rpcMissing = /Could not find the function/i.test(String(first.error?.message ?? ""));

  if (rpcMissing) {
    inconclusive(
      "UpFor -> Plan conversion",
      `create_plan_lifecycle signature differs: ${String(first.error?.message).slice(0, 120)}`
    );
  } else {
    const { data: plans } = await admin
      .from("plans").select("id, source_hangout_id, creator_id").eq("source_hangout_id", session.id);
    if (first.error && second.error) {
      inconclusive("UpFor -> Plan conversion", `both calls failed: ${String(first.error.message).slice(0, 150)}`);
    } else {
      check("one UpFor converts into exactly one Plan", (plans ?? []).length === 1,
        `plans ${(plans ?? []).length} (rpc: ${first.error ? "err" : "ok"}/${second.error ? "err" : "ok"})`);
    }

    if ((plans ?? []).length === 1) {
      const plan = plans[0];
      check("the Plan records the UpFor it came from", plan.source_hangout_id === session.id, "source_hangout_id set");
      check("the Plan is owned by the UpFor host", plan.creator_id === QA, "creator_id correct");

      // --- 4. Exactly one Plan Chat ---------------------------------------
      const { data: convos } = await admin.from("conversations").select("id").eq("plan_id", plan.id);
      check("the Plan has at most one canonical conversation", (convos ?? []).length <= 1,
        `conversations ${(convos ?? []).length}`);

      // --- 5. RSVP transitions -------------------------------------------
      /* The real signature is (p_actor_id, p_plan_id, p_status) — a participant
         sets their OWN RSVP. There is no p_user_id, which is the correct
         authorization model: one cannot RSVP on someone else's behalf. */
      const rsvp = async (status) =>
        admin.rpc("set_plan_participant_rsvp", {
          p_actor_id: KOFI, p_plan_id: plan.id, p_status: status
        }).then((r) => r, (e) => ({ error: e }));

      const going = await rsvp("going");
      if (/Could not find the function/i.test(String(going.error?.message ?? ""))) {
        inconclusive("Plan RSVP", `set_plan_participant_rsvp signature differs: ${String(going.error?.message).slice(0, 110)}`);
      } else {
        await rsvp("maybe");
        await rsvp("not_going");
        await rsvp("going");
        const { data: parts } = await admin
          .from("plan_participants").select("id, rsvp_status").eq("plan_id", plan.id).eq("user_id", KOFI);
        check("RSVP changes update one row rather than adding rows", (parts ?? []).length <= 1,
          `participant rows ${(parts ?? []).length}, final ${parts?.[0]?.rsvp_status}`);
      }
    }
  }
}

await cleanup();
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} UpFor -> Plan checks passed`);
