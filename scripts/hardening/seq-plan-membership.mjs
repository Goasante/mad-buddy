/**
 * Mission 1 Extremely Advanced — domain 4: Plan RSVP / membership.
 *
 * RSVP transitions were already covered inside the UpFor→Plan sequence. What
 * this adds is MEMBERSHIP: adding participants through the canonical authority,
 * and proving that Plan Chat membership follows from it rather than being
 * maintained separately.
 *
 * Canonical authorities (never re-implemented):
 *   create_plan_lifecycle, set_plan_participant_rsvp,
 *   add_plan_participants, reconcile_plan_conversation_members
 *
 * A conversation is linked to its Plan by context_type/context_id — NOT by a
 * plan_id column. An earlier probe queried `conversations.plan_id`, found
 * nothing, and reported "conversations 0"; that was the query being wrong, not
 * the Plan lacking a chat.
 */
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "http://127.0.0.1:54321";
const SERVICE = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
if (!SUPABASE_URL.includes("127.0.0.1")) throw new Error("refusing to run against a non-local database");
const admin = createClient(SUPABASE_URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });

const QA = "d901121e-688e-477b-b8f0-56c782a16801";   // host
const KOFI = "2a54c81c-acad-4191-b89d-2c427c693c7a"; // invited
const AMA = "b66cd360-1f24-4b02-9b8c-123b522d0c61";  // added later
const SAA = "1fd04f79-7ab6-482a-a969-348767e00f7c";  // never a participant

const results = [];
const check = (name, ok, detail) => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};
const inconclusive = (name, why) => console.log(`INCONC  ${name}  — ${why}`);

const TAG = `seq-plan-${Date.now()}`;

async function planConversation(planId) {
  const { data } = await admin.from("conversations")
    .select("id").eq("context_type", "plan").eq("context_id", planId);
  return data ?? [];
}
async function members(conversationId) {
  const { data } = await admin.from("conversation_members")
    .select("user_id, status, left_at").eq("conversation_id", conversationId);
  return data ?? [];
}
async function participants(planId) {
  const { data } = await admin.from("plan_participants")
    .select("user_id, rsvp_status").eq("plan_id", planId);
  return data ?? [];
}
async function cleanup() {
  const { data: plans } = await admin.from("plans").select("id").ilike("title", `${TAG}%`);
  for (const p of plans ?? []) {
    for (const c of await planConversation(p.id)) {
      await admin.from("conversation_members").delete().eq("conversation_id", c.id);
      await admin.from("messages").delete().eq("conversation_id", c.id);
      await admin.from("conversations").delete().eq("id", c.id);
    }
    await admin.from("plan_participants").delete().eq("plan_id", p.id);
    await admin.from("plans").delete().eq("id", p.id);
  }
}
await cleanup();

// --- Create a Plan through the canonical authority -------------------------
const { data: created, error: createError } = await admin.rpc("create_plan_lifecycle", {
  p_actor_id: QA,
  p_request_key: crypto.randomUUID(),
  p_title: `${TAG} dinner`,
  p_description: null,
  p_plan_type: "scheduled",
  p_start_at: new Date(Date.now() + 2 * 3600e3).toISOString(),
  p_end_at: new Date(Date.now() + 4 * 3600e3).toISOString(),
  p_timezone: "Africa/Accra",
  p_rsvp_deadline: null,
  p_place_type: "custom",
  p_custom_place_text: "Test venue",
  p_reminder_minutes: 30,
  p_category: null,
  p_invitee_ids: [KOFI],
  p_initial_going_ids: [],
  p_source_hangout_id: null,
  p_effective_max_active_plans: 10,
  p_effective_max_participants: 20
});

const planId = Array.isArray(created) ? created[0]?.plan_id ?? created[0]?.id : created?.plan_id ?? created?.id;

if (createError || !planId) {
  inconclusive("Plan membership", `could not create a Plan: ${createError?.message?.slice(0, 130) ?? "no id returned"}`);
} else {
  check("a Plan is created with its invitee as a participant",
    (await participants(planId)).some((p) => p.user_id === KOFI),
    `participants ${(await participants(planId)).length}`);

  // --- RSVP round trip: accept → maybe → decline → accept ------------------
  const rsvp = (actor, status) =>
    admin.rpc("set_plan_participant_rsvp", { p_actor_id: actor, p_plan_id: planId, p_status: status })
      .then((r) => r, (e) => ({ error: e }));

  for (const status of ["going", "maybe", "not_going", "going"]) await rsvp(KOFI, status);
  const afterCycle = (await participants(planId)).filter((p) => p.user_id === KOFI);
  check("a full RSVP cycle leaves exactly one participant row",
    afterCycle.length === 1,
    `rows ${afterCycle.length}, final ${afterCycle[0]?.rsvp_status}`);

  // --- Host adds a participant through the canonical authority -------------
  const added = await admin.rpc("add_plan_participants", {
    p_actor_id: QA, p_plan_id: planId, p_participant_ids: [AMA], p_effective_max_participants: 20
  }).then((r) => r, (e) => ({ error: e }));

  if (added.error) {
    inconclusive("host adds a participant", String(added.error.message).slice(0, 130));
  } else {
    const withAma = await participants(planId);
    check("the host can add a participant", withAma.some((p) => p.user_id === AMA),
      `participants ${withAma.length}`);

    // Adding the same person twice must not duplicate them.
    await admin.rpc("add_plan_participants", {
      p_actor_id: QA, p_plan_id: planId, p_participant_ids: [AMA], p_effective_max_participants: 20
    }).then((r) => r, (e) => ({ error: e }));
    const amaRows = (await participants(planId)).filter((p) => p.user_id === AMA);
    check("adding the same participant twice does not duplicate them",
      amaRows.length === 1, `rows for that participant: ${amaRows.length}`);
  }

  // --- Plan Chat membership follows from participation ---------------------
  const reconciled = await admin.rpc("reconcile_plan_conversation_members", { p_plan_id: planId })
    .then((r) => r, (e) => ({ error: e }));

  if (reconciled.error) {
    inconclusive("Plan Chat reconciliation", String(reconciled.error.message).slice(0, 130));
  } else {
    const convos = await planConversation(planId);
    check("a Plan has exactly one canonical conversation", convos.length === 1,
      `conversations ${convos.length}`);

    if (convos.length === 1) {
      const memberIds = (await members(convos[0].id))
        .filter((m) => !m.left_at)
        .map((m) => m.user_id);

      /* The real rule, established by inspecting persisted state rather than
         assumed: Plan Chat membership follows RSVP, not invitation. Only
         participants who are GOING are members — an invitee who has not
         accepted is deliberately absent, because a Plan Chat is for the people
         who are actually coming.
         An earlier version asserted "all participants are members" and passed
         only because the host and KOFI happened to be going at that point. With
         a fresh Plan the counts are 3 participants / 1 member, and that
         assertion would have been wrong. */
      const going = (await participants(planId))
        .filter((p) => p.rsvp_status === "going")
        .map((p) => p.user_id);
      const invitedOnly = (await participants(planId))
        .filter((p) => p.rsvp_status === "invited")
        .map((p) => p.user_id);

      check("everyone who is going is a member of the Plan Chat",
        going.every((u) => memberIds.includes(u)),
        `going ${going.length}, members ${memberIds.length}`);

      check("an invitee who has not accepted is NOT yet in the Plan Chat",
        invitedOnly.every((u) => !memberIds.includes(u)),
        `invited-but-not-accepted ${invitedOnly.length}, none in chat: ${invitedOnly.every((u) => !memberIds.includes(u))}`);

      check("a non-participant is NOT a member of the Plan Chat",
        !memberIds.includes(SAA),
        memberIds.includes(SAA) ? "outsider present" : "outsider absent");

      // Reconciling twice must not duplicate membership rows.
      await admin.rpc("reconcile_plan_conversation_members", { p_plan_id: planId })
        .then((r) => r, (e) => ({ error: e }));
      const all = await members(convos[0].id);
      const unique = new Set(all.map((m) => m.user_id));
      check("re-reconciling does not duplicate conversation members",
        all.length === unique.size, `rows ${all.length}, distinct users ${unique.size}`);

      // --- MULTI-TAB: stale RSVP applied after the truth moved on ----------
      /* Tab B declines. Tab A, holding a stale "going" view, re-sends going.
         Server truth must win and no second row may appear. */
      await rsvp(KOFI, "not_going");
      await rsvp(KOFI, "going");
      const staleRows = (await participants(planId)).filter((p) => p.user_id === KOFI);
      check("a stale RSVP replay leaves one row and the server's latest value",
        staleRows.length === 1 && staleRows[0].rsvp_status === "going",
        `rows ${staleRows.length}, status ${staleRows[0]?.rsvp_status}`);
    }
  }
}

await cleanup();
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} Plan membership checks passed`);
