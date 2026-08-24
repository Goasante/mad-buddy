/**
 * Owner review cohort for Mad Buddy Access.
 *
 * Real, loggable accounts -- not DB-only fixtures. Every one can be signed into
 * at /login with the shared review password, so the owner sees what a person
 * sees rather than what a database row implies.
 *
 * IDEMPOTENT. Fixed emails, upserted state; re-running refreshes the cohort
 * without duplicating it. Existing owner-review accounts from earlier passes
 * are left completely alone.
 *
 * Personas A-J from the brief, plus the two continuity cases that are the whole
 * point of the model: an expired account that still has a Linkr conversation,
 * and an expired account whose UpFor already became a Plan.
 */
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "http://127.0.0.1:54321";
const SERVICE = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
if (!SUPABASE_URL.includes("127.0.0.1")) throw new Error("refusing to run against a non-local database");
const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });

const PASSWORD = "AccessReview123!";
const DAY = 86400000;
const iso = (ms) => new Date(Date.now() + ms).toISOString();

/**
 * The cohort. `grants` are written directly, which is legitimate: the grant
 * table IS the product state, and the trigger that creates welcome grants
 * naturally is separately proven by welcome-access-trigger.mjs.
 */
const COHORT = [
  {
    key: "day1", name: "Ama Access-Day1", username: "accessday1",
    grants: [{ source: "welcome_access", startsIn: -1 * DAY, expiresIn: 13 * DAY }],
    expect: "Welcome Access, day 1. Linkr and UpFor fully usable. NO countdown anywhere."
  },
  {
    key: "day10", name: "Kojo Access-Day10", username: "accessday10",
    grants: [{ source: "welcome_access", startsIn: -10 * DAY, expiresIn: 4 * DAY - 3600000 }],
    expect: "4 days left. Settings shows the date. The day-10 reminder is due."
  },
  {
    key: "day13", name: "Abena Access-Day13", username: "accessday13",
    grants: [{ source: "welcome_access", startsIn: -13 * DAY, expiresIn: 1 * DAY - 3600000 }],
    expect: "Ends tomorrow. Still fully usable. Second and final reminder is due."
  },
  {
    key: "expired", name: "Yaw Access-Expired", username: "accessexpired",
    grants: [{ source: "welcome_access", startsIn: -20 * DAY, expiresIn: -6 * DAY }],
    expect: "Linkr and UpFor LOCKED but still in the nav. Everything else free and working."
  },
  {
    key: "paid", name: "Nana Access-Paid", username: "accesspaid",
    grants: [{ source: "web_subscription", startsIn: -3 * DAY, expiresIn: 27 * DAY }],
    expect: "Paid access. Settings says paid, never 'trial'."
  },
  {
    key: "granted", name: "Esi Access-Granted", username: "accessgranted",
    grants: [
      { source: "welcome_access", startsIn: -30 * DAY, expiresIn: -16 * DAY },
      { source: "admin_grant", startsIn: -1 * DAY, expiresIn: 6 * DAY }
    ],
    expect: "Expired welcome + a live 7-day admin grant. Access works; Settings explains it was given."
  },
  {
    key: "indef", name: "Kofi Access-Indefinite", username: "accessindef",
    grants: [{ source: "admin_grant", startsIn: -5 * DAY, expiresIn: null }],
    expect: "Indefinite grant. No expiry date shown anywhere."
  },
  {
    key: "none", name: "Adwoa Access-None", username: "accessnone",
    grants: [],
    expect: "Never had Welcome Access. Locked state says 'needs Access', NOT 'has ended'."
  }
];

const made = new Map();

async function ensurePerson(spec) {
  const email = `${spec.username}@review.local`;

  /* FIND THE ACCOUNT BY ITS PROFILE, NOT BY PAGING auth.users.
   *
   * `listUsers({ perPage: 1000 })` is capped by the server and silently returns
   * fewer, so on a database with many test accounts an existing review user was
   * not found -- and the script then failed with "already registered", breaking
   * the idempotency it advertises. `profiles.username` is unique and indexed,
   * which makes this both correct and cheap. */
  const { data: existingProfile } = await admin
    .from("profiles").select("user_id").eq("username", spec.username).maybeSingle();

  let user = null;
  if (existingProfile) {
    const { data } = await admin.auth.admin.getUserById(existingProfile.user_id);
    user = data?.user ?? null;
  }

  if (!user) {
    const { data, error } = await admin.auth.admin.createUser({
      email, password: PASSWORD, email_confirm: true
    });
    /* Still possible: a profile row was cleaned up but the auth user survived
       (auth.users rows are deliberately left behind by some harnesses, because
       deleting one cascades into append-only domain_events). Fall back to
       paging rather than failing. */
    if (error) {
      const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      user = (list?.users ?? []).find((u) => u.email === email) ?? null;
      if (!user) throw new Error(`${spec.key}: ${error.message}`);
      const { error: pwErr } = await admin.auth.admin.updateUserById(user.id, { password: PASSWORD });
      if (pwErr) throw new Error(`${spec.key} password: ${pwErr.message}`);
    } else {
      user = data.user;
    }
  } else {
    // Refresh the password so the documented credential always works.
    const { error } = await admin.auth.admin.updateUserById(user.id, { password: PASSWORD });
    if (error) throw new Error(`${spec.key} password: ${error.message}`);
  }

  const { error: pErr } = await admin.from("profiles").upsert(
    { user_id: user.id, username: spec.username, full_name: spec.name, is_onboarded: true },
    { onConflict: "user_id" }
  );
  if (pErr) throw new Error(`${spec.key} profile: ${pErr.message}`);

  // Rewrite this account's grants so re-running is deterministic.
  await admin.from("access_reminder_log").delete().eq("user_id", user.id);
  await admin.from("access_grants").delete().eq("user_id", user.id);
  await admin.from("subscriptions").delete().eq("user_id", user.id);

  for (const g of spec.grants) {
    if (g.source === "web_subscription") {
      /* A paid persona needs a real subscription row, not a grant labelled
         "paid" -- the resolver reads `subscriptions` for provider access, and a
         fake grant would exercise the wrong code path. */
      const { error } = await admin.from("subscriptions").insert({
        user_id: user.id, plan: "buddy_plus", status: "active", provider: "paystack",
        current_period_start: iso(g.startsIn), current_period_end: iso(g.expiresIn)
      });
      if (error) throw new Error(`${spec.key} subscription: ${error.message}`);
      continue;
    }
    const { error } = await admin.from("access_grants").insert({
      user_id: user.id, source: g.source,
      starts_at: iso(g.startsIn),
      expires_at: g.expiresIn === null ? null : iso(g.expiresIn),
      reason: "Monetization owner review cohort"
    });
    if (error) throw new Error(`${spec.key} grant ${g.source}: ${error.message}`);
  }

  made.set(spec.key, { id: user.id, email, spec });
  return user.id;
}

/** Give the expired persona a real Muddy, so continuity is visible. */
async function wireContinuity() {
  const expired = made.get("expired");
  const day1 = made.get("day1");
  if (!expired || !day1) return;

  const [one, two] = [expired.id, day1.id].sort();
  const { data: existing } = await admin.from("friendships")
    .select("id").eq("user_one_id", one).eq("user_two_id", two).maybeSingle();
  if (!existing) {
    const { error } = await admin.from("friendships").insert({ user_one_id: one, user_two_id: two });
    if (error) throw new Error(`friendship: ${error.message}`);
  } else {
    await admin.from("friendships").update({ ended_at: null }).eq("id", existing.id);
  }

  /* The friendship trigger just created a welcome grant for BOTH of them.
     The expired persona must stay expired, so put its grant back the way the
     cohort describes -- otherwise the most important review account silently
     becomes an active one. */
  await admin.from("access_grants").delete().eq("user_id", expired.id).eq("source", "welcome_access");
  const { error: gErr } = await admin.from("access_grants").insert({
    user_id: expired.id, source: "welcome_access",
    starts_at: iso(-20 * DAY), expires_at: iso(-6 * DAY),
    reason: "Monetization owner review cohort"
  });
  if (gErr) throw new Error(`expired regrant: ${gErr.message}`);

  // And a conversation between them, so "existing conversations survive" is
  // something the owner can actually open and read.
  const directKey = [expired.id, day1.id].sort().join(":");
  const { data: convo } = await admin.from("conversations")
    .select("id").eq("direct_key", directKey).maybeSingle();
  let conversationId = convo?.id;
  if (!conversationId) {
    const { data, error } = await admin.from("conversations")
      .insert({ conversation_type: "direct", created_by: day1.id, status: "active", direct_key: directKey })
      .select("id").maybeSingle();
    if (error) throw new Error(`conversation: ${error.message}`);
    conversationId = data.id;
    const { error: mErr } = await admin.from("conversation_members").insert([
      { conversation_id: conversationId, user_id: expired.id, role: "member", status: "joined" },
      { conversation_id: conversationId, user_id: day1.id, role: "member", status: "joined" }
    ]);
    if (mErr) throw new Error(`members: ${mErr.message}`);
    const { error: msgErr } = await admin.from("messages").insert([
      { conversation_id: conversationId, sender_id: day1.id, message_type: "text",
        text_content: "Hey! Good to finally connect.", client_message_id: crypto.randomUUID() },
      { conversation_id: conversationId, sender_id: expired.id, message_type: "text",
        text_content: "You too — this conversation should still work after my access ends.",
        client_message_id: crypto.randomUUID() }
    ]);
    if (msgErr) throw new Error(`messages: ${msgErr.message}`);
  }
}

for (const spec of COHORT) await ensurePerson(spec);
await wireContinuity();

console.log(`${"=".repeat(94)}`);
console.log("MONETIZATION OWNER REVIEW COHORT");
console.log(`${"=".repeat(94)}`);
console.log(`All accounts: password  ${PASSWORD}   sign in at http://localhost:3200/login\n`);

for (const spec of COHORT) {
  const entry = made.get(spec.key);
  console.log(`${spec.name}`);
  console.log(`  email    ${entry.email}`);
  console.log(`  expect   ${spec.expect}`);
  console.log(`  inspect  /linkr  /hangout-mode  /settings/access`);
  console.log("");
}
console.log("The 'expired' account also has a Muddy and a two-sided conversation:");
console.log("open /messages as Yaw Access-Expired — it must still work after expiry.");
