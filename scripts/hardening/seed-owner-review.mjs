/**
 * Owner manual-review cohort.
 *
 * Every account here is loggable through the normal app at
 * http://localhost:3200/login. These are LOCAL disposable fixtures on the
 * Docker Supabase stack — no production data, no secrets.
 *
 * Idempotent: re-running reuses accounts that already exist rather than
 * creating duplicates, so the owner's review state survives repeated runs.
 *
 * FIXTURE DISCIPLINE: every write reads its error, and every state is one the
 * real product can create. `friendships` has no `status` column;
 * `profiles_username_format` rejects hyphens; `linkr_record_connect` takes
 * p_actor/p_target/p_event_id; `hangout_ends_after_start` forbids an end time
 * before the start.
 */
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "http://127.0.0.1:54321";
const SERVICE = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
if (!SUPABASE_URL.includes("127.0.0.1")) throw new Error("refusing to seed a non-local database");
const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });

const PASSWORD = "ReviewPass123!";

/** Creates the account if absent; always returns its id. */
async function person(slug, fullName) {
  const email = `${slug}@review.local`;
  const { data: list } = await admin.auth.admin.listUsers();
  const found = list?.users?.find((u) => u.email === email);
  let id = found?.id;
  if (!id) {
    const { data, error } = await admin.auth.admin.createUser({
      email, password: PASSWORD, email_confirm: true,
      user_metadata: { full_name: fullName, username: slug }
    });
    if (error) throw new Error(`${slug}: ${error.message}`);
    id = data.user.id;
  } else {
    // Keep the password predictable for the owner across re-runs.
    await admin.auth.admin.updateUserById(id, { password: PASSWORD });
  }
  const { data: profile } = await admin.from("profiles").select("user_id").eq("user_id", id).maybeSingle();
  if (!profile) {
    const { error } = await admin.from("profiles").insert({
      user_id: id, username: slug, username_normalized: slug,
      full_name: fullName, visibility_status: "visible", is_onboarded: true
    });
    if (error) throw new Error(`${slug} profile: ${error.message}`);
  }
  return { id, email, slug, fullName };
}

async function befriend(a, b) {
  const [x, y] = [a, b].sort();
  const { data: existing } = await admin.from("friendships")
    .select("id").eq("user_one_id", x).eq("user_two_id", y).is("ended_at", null).maybeSingle();
  if (existing) return;
  const { error } = await admin.from("friendships").insert({ user_one_id: x, user_two_id: y });
  if (error) throw new Error(`friendship: ${error.message}`);
}

async function enableLinkr(id, intent = "friends") {
  const { error } = await admin.from("linkr_profiles")
    .upsert({ user_id: id, enabled: true, intent }, { onConflict: "user_id" });
  if (error) throw new Error(`linkr profile: ${error.message}`);
}

const out = [];

// --- The cohort -----------------------------------------------------------
const ama = await person("reviewama", "Ama Owner-Review");
const kojo = await person("reviewkojo", "Kojo Owner-Review");
const nana = await person("reviewnana", "Nana Owner-Review");
const yaw = await person("reviewyaw", "Yaw Owner-Review");
const abena = await person("reviewabena", "Abena Owner-Review");

// A: mature social account — Muddies, an unread message, an UpFor with responses
await befriend(ama.id, kojo.id);
await befriend(ama.id, nana.id);

// An unread message TO Ama, so Home's setup suppression (MB-GOD-052) is visible.
const directKey = [ama.id, kojo.id].sort().join(":");
const { data: convo } = await admin.from("conversations")
  .select("id").eq("direct_key", directKey).maybeSingle();
let conversationId = convo?.id;
if (!conversationId) {
  const { data: created, error } = await admin.from("conversations")
    .insert({ conversation_type: "direct", created_by: kojo.id, status: "active", direct_key: directKey })
    .select("id").maybeSingle();
  if (error) throw new Error(`conversation: ${error.message}`);
  conversationId = created.id;
  const { error: mErr } = await admin.from("conversation_members").insert([
    { conversation_id: conversationId, user_id: ama.id, role: "member", status: "joined" },
    { conversation_id: conversationId, user_id: kojo.id, role: "member", status: "joined" }
  ]);
  if (mErr) throw new Error(`members: ${mErr.message}`);
  const { error: msgErr } = await admin.from("messages").insert({
    conversation_id: conversationId, sender_id: kojo.id, message_type: "text",
    text_content: "Are you around this weekend?", client_message_id: crypto.randomUUID()
  });
  if (msgErr) throw new Error(`message: ${msgErr.message}`);
}

// An UpFor owned by Ama, with Kojo and Nana responding — momentum is visible.
const { data: existingUpfor } = await admin.from("hangout_sessions")
  .select("id").eq("owner_id", ama.id).eq("status", "active").maybeSingle();
let upforId = existingUpfor?.id;
if (!upforId) {
  const { data: created, error } = await admin.from("hangout_sessions").insert({
    owner_id: ama.id, activity_type: "food", audience_type: "all_muddies",
    message: "Late lunch, anyone?",
    starts_at: new Date().toISOString(),
    ends_at: new Date(Date.now() + 6 * 3600e3).toISOString(),
    max_participants: 4, status: "active"
  }).select("id").maybeSingle();
  if (error) throw new Error(`upfor: ${error.message}`);
  upforId = created.id;
  for (const responder of [kojo.id, nana.id]) {
    const { error: rErr } = await admin.from("hangout_requests")
      .insert({ hangout_session_id: upforId, requester_id: responder, status: "pending" });
    if (rErr) throw new Error(`upfor request: ${rErr.message}`);
  }
}

// B: brand-new account — zero Muddies, so the empty-network state is visible.
// (Abena is deliberately left with no relationships.)

// C → D: one-sided Linkr interest. D must see NOTHING of it.
await enableLinkr(yaw.id);
await enableLinkr(abena.id);
const { error: oneWayErr } = await admin.rpc("linkr_record_connect", {
  p_actor: yaw.id, p_target: abena.id, p_event_id: null
});
if (oneWayErr) console.log(`note: one-sided linkr connect: ${oneWayErr.message.slice(0, 90)}`);

// E ↔ F: mutual Linkr connection between Kojo and Nana.
await enableLinkr(kojo.id);
await enableLinkr(nana.id);
for (const [a, b] of [[kojo.id, nana.id], [nana.id, kojo.id]]) {
  const { error } = await admin.rpc("linkr_record_connect", { p_actor: a, p_target: b, p_event_id: null });
  if (error) console.log(`note: mutual linkr connect: ${error.message.slice(0, 90)}`);
}

out.push({ role: "mature social", email: ama.email, note: "Muddies, unread message, UpFor with 2 responses" });
out.push({ role: "responder + Linkr mutual", email: kojo.email, note: "Muddy of Ama; mutual Linkr with Nana" });
out.push({ role: "responder + Linkr mutual", email: nana.email, note: "Muddy of Ama; mutual Linkr with Kojo" });
out.push({ role: "one-sided Linkr interest", email: yaw.email, note: "connected to Abena; she must see nothing" });
out.push({ role: "brand-new / empty network", email: abena.email, note: "no Muddies; target of Yaw's interest" });

console.log(`\npassword for every account: ${PASSWORD}\n`);
for (const r of out) console.log(`${r.email.padEnd(28)} ${r.role.padEnd(28)} ${r.note}`);
console.log("\nseeded (idempotent — safe to re-run)");
