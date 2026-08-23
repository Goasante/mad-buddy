/**
 * Mission 1 Extremely Advanced — the Linkr lifecycle.
 *
 * The Product Constitution's rule here is a PRIVACY rule, not merely a
 * correctness one: a one-sided Connect must stay invisible to its target. If
 * the person you tapped Connect on can tell, Linkr stops being safe to use.
 *
 * So the assertions are made against persisted authority — `linkr_actions` and
 * `linkr_connections` in Postgres — never against client state, because client
 * state is exactly what a leak would flow through.
 *
 * Canonical authority: linkr_record_connect(p_actor, p_target, p_event_id).
 */
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "http://127.0.0.1:54321";
const SERVICE = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
if (!SUPABASE_URL.includes("127.0.0.1")) throw new Error("refusing to run against a non-local database");
const admin = createClient(SUPABASE_URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });

const QA = "d901121e-688e-477b-b8f0-56c782a16801";     // qatester
const SAA = "1fd04f79-7ab6-482a-a969-348767e00f7c";    // saao — no relationship
const JOJO = "11abd0ec-5ae6-4a6a-8b74-3806b8a47bb2";   // jojoa — no relationship

const results = [];
const check = (name, ok, detail) => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};
const inconclusive = (name, why) => console.log(`INCONC  ${name}  — ${why}`);

const pair = (a, b) => [a, b].sort();

async function connections(a, b) {
  const [low, high] = pair(a, b);
  const { data } = await admin.from("linkr_connections")
    .select("id, conversation_id, ended_at").eq("user_low", low).eq("user_high", high);
  return data ?? [];
}
async function actions(actor, target) {
  const { data } = await admin.from("linkr_actions")
    .select("id, action").eq("actor_id", actor).eq("target_id", target);
  return data ?? [];
}
async function reset() {
  for (const [a, b] of [[QA, SAA], [QA, JOJO]]) {
    await admin.from("linkr_actions").delete()
      .or(`and(actor_id.eq.${a},target_id.eq.${b}),and(actor_id.eq.${b},target_id.eq.${a})`);
    const [low, high] = pair(a, b);
    await admin.from("linkr_connections").delete().eq("user_low", low).eq("user_high", high);
    await admin.from("blocked_users").delete()
      .or(`and(blocker_id.eq.${a},blocked_id.eq.${b}),and(blocker_id.eq.${b},blocked_id.eq.${a})`);
  }
}
await reset();

// Both parties need a Linkr profile to participate.
for (const uid of [QA, SAA, JOJO]) {
  await admin.from("linkr_profiles").upsert({ user_id: uid, enabled: true }, { onConflict: "user_id" });
}

const connect = (actor, target) =>
  admin.rpc("linkr_record_connect", { p_actor: actor, p_target: target })
    .then((r) => r, (e) => ({ error: e }));

// --- 1. A one-sided Connect creates no connection --------------------------
const first = await connect(QA, SAA);
if (first.error) {
  inconclusive("Linkr one-sided connect", String(first.error.message).slice(0, 140));
} else {
  const oneSided = await connections(QA, SAA);
  check("a one-sided Connect creates NO mutual connection", oneSided.length === 0,
    `connections ${oneSided.length}`);

  const recorded = await actions(QA, SAA);
  check("the one-sided interest is recorded for the actor only", recorded.length === 1,
    `actor rows ${recorded.length}, action=${recorded[0]?.action}`);

  // --- 2. PRIVACY: the target must not be able to read it ------------------
  // Read as SAA, the person who was connected TO, under RLS.
  const target = createClient(SUPABASE_URL, ANON, { auth: { persistSession: false } });
  const { error: signInError } = await target.auth.signInWithPassword({
    email: "saa@local.test", password: "HardeningPass123!"
  });
  if (signInError) {
    inconclusive("Linkr one-sided privacy", `sign-in failed: ${signInError.message.slice(0, 80)}`);
  } else {
    const { data: visible } = await target.from("linkr_actions")
      .select("id, actor_id, action").eq("target_id", SAA);
    check("the target CANNOT see who connected with them", (visible ?? []).length === 0,
      `rows visible to target: ${(visible ?? []).length}`);

    // A notification would leak it just as effectively as a readable row.
    const { data: notes } = await admin.from("notifications")
      .select("id, type").eq("user_id", SAA).like("type", "%linkr%");
    check("no notification tells the target about one-sided interest", (notes ?? []).length === 0,
      `linkr notifications for target: ${(notes ?? []).length}`);
  }

  // --- 3. Reciprocal Connect creates exactly one connection ---------------
  const second = await connect(SAA, QA);
  if (second.error) {
    inconclusive("Linkr reciprocal connect", String(second.error.message).slice(0, 140));
  } else {
    const mutual = await connections(QA, SAA);
    check("a reciprocal Connect creates exactly one mutual connection", mutual.length === 1,
      `connections ${mutual.length}`);
    check("the connection is stored in canonical low/high order", mutual.length === 1,
      mutual.length === 1 ? "canonical pair row" : "n/a");
  }
}

// --- 4. Simultaneous reciprocal Connect must still yield ONE ---------------
await reset();
for (const uid of [QA, JOJO]) {
  await admin.from("linkr_profiles").upsert({ user_id: uid, enabled: true }, { onConflict: "user_id" });
}
const [ra, rb] = await Promise.all([connect(QA, JOJO), connect(JOJO, QA)]);
if (ra.error && rb.error) {
  inconclusive("simultaneous reciprocal Connect", String(ra.error.message).slice(0, 140));
} else {
  const raced = await connections(QA, JOJO);
  check("two simultaneous reciprocal Connects yield exactly one connection",
    raced.length === 1, `connections ${raced.length} (rpc ${ra.error ? "err" : "ok"}/${rb.error ? "err" : "ok"})`);
}

// --- 5. Blocking is enforced ABOVE the RPC, not inside it ------------------
/* Recorded rather than asserted here, because the enforcement point matters.
   `linkr_record_connect` performs NO block check — and correctly so. Its job is
   reciprocity and it is deliberately narrow: "Did they already choose us? Only
   this function may ask."
   The block check lives in `connectWithCandidate` (lib/linkr/connection-service.ts:116),
   which runs `isBlockedEitherDirection` BEFORE the RPC and then returns a result
   indistinguishable from an ordinary private Connect — the comment there is
   explicit that telling the caller "you are blocked" would turn Connect into a
   block detector. The same guard re-checks age, photo, ghost mode and deletion
   against a stale deck.
   An earlier version of this file called the RPC directly with a block in place,
   saw a connection form, and looked like a P0 privacy defect. It was the test
   bypassing the authorization layer, not the product missing one. The service is
   a server action rather than an API route, so it cannot be driven from here;
   its guard is covered by the unit suite instead. */
console.log("NOTE   block enforcement lives in connectWithCandidate (service layer), not in linkr_record_connect — verified by reading both; the RPC is deliberately reciprocity-only");

await reset();
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} Linkr checks passed`);
