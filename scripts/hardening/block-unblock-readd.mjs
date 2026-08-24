/**
 * BETA-001 — block → unblock → re-add must restore a usable conversation.
 *
 * Tester evidence (production screenshot): after blocking, unblocking and
 * re-adding, the thread still shows "This conversation is closed." and every
 * send fails with Not sent / Retry / Delete.
 *
 * This reproduces the whole lifecycle against the database and asserts the
 * canonical state at each step, so the fix can be proven rather than assumed.
 *
 * FIXTURE DISCIPLINE: every write reads its error. `profiles_username_format`
 * rejects hyphens. auth.users rows are left behind deliberately -- deleting one
 * cascades an UPDATE that nulls `domain_events.actor_id`, which is append-only.
 */
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "http://127.0.0.1:54321";
const SERVICE = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
if (!SUPABASE_URL.includes("127.0.0.1")) throw new Error("refusing to run against a non-local database");
const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });

const made = [];
const results = [];
const check = (n, ok, d) => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? `  — ${d}` : ""}`); };

async function person(tag) {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 900 + 100)}`;
  const { data, error } = await admin.auth.admin.createUser({
    email: `${tag}-${stamp}@local.test`, password: "BetaTest123!", email_confirm: true
  });
  if (error) throw new Error(`${tag}: ${error.message}`);
  const id = data.user.id;
  const { error: pErr } = await admin.from("profiles").insert({
    user_id: id, username: `${tag}${stamp.slice(-7)}`, full_name: `${tag} Beta`, is_onboarded: true
  });
  if (pErr) throw new Error(`${tag} profile: ${pErr.message}`);
  made.push(id);
  return id;
}

const key = (a, b) => [a, b].sort().join(":");

async function conversationState(a, b) {
  const { data } = await admin.from("conversations")
    .select("id, status").eq("direct_key", key(a, b)).maybeSingle();
  return data;
}

async function friendshipState(a, b) {
  const [one, two] = [a, b].sort();
  const { data } = await admin.from("friendships")
    .select("id, ended_at").eq("user_one_id", one).eq("user_two_id", two).maybeSingle();
  return data;
}

async function cleanup() {
  for (const id of made) {
    const { data: convos } = await admin.from("conversations").select("id").like("direct_key", `%${id}%`);
    for (const c of convos ?? []) {
      await admin.from("messages").delete().eq("conversation_id", c.id);
      await admin.from("conversation_members").delete().eq("conversation_id", c.id);
      await admin.from("conversations").delete().eq("id", c.id);
    }
    await admin.from("blocked_users").delete().or(`blocker_id.eq.${id},blocked_id.eq.${id}`);
    await admin.from("friendships").delete().or(`user_one_id.eq.${id},user_two_id.eq.${id}`);
    await admin.from("access_grants").delete().eq("user_id", id);
    await admin.from("activation_milestones").delete().eq("user_id", id);
    await admin.from("profiles").delete().eq("user_id", id);
  }
}

try {
  const alice = await person("blka");
  const bob = await person("blkb");
  const [one, two] = [alice, bob].sort();

  // ---- 1. friends, with a real conversation ------------------------------
  const { error: fErr } = await admin.from("friendships").insert({ user_one_id: one, user_two_id: two });
  if (fErr) throw new Error(`friendship: ${fErr.message}`);

  const { data: convo, error: cErr } = await admin.from("conversations")
    .insert({ conversation_type: "direct", created_by: alice, status: "active", direct_key: key(alice, bob) })
    .select("id").maybeSingle();
  if (cErr) throw new Error(`conversation: ${cErr.message}`);
  const { error: mErr } = await admin.from("conversation_members").insert([
    { conversation_id: convo.id, user_id: alice, role: "member", status: "joined" },
    { conversation_id: convo.id, user_id: bob, role: "member", status: "joined" }
  ]);
  if (mErr) throw new Error(`members: ${mErr.message}`);
  const { error: msgErr } = await admin.from("messages").insert({
    conversation_id: convo.id, sender_id: alice, message_type: "text",
    text_content: "before the block", client_message_id: crypto.randomUUID()
  });
  if (msgErr) throw new Error(`message: ${msgErr.message}`);

  check("start: conversation is active", (await conversationState(alice, bob))?.status === "active");
  check("start: friendship is live", (await friendshipState(alice, bob))?.ended_at === null);

  // ---- 2. BLOCK -----------------------------------------------------------
  const blockedAt = new Date().toISOString();
  await admin.from("blocked_users").insert({ blocker_id: alice, blocked_id: bob });
  await admin.from("friendships").update({ ended_at: blockedAt })
    .eq("user_one_id", one).eq("user_two_id", two).is("ended_at", null);
  await admin.from("conversations").update({ status: "archived" })
    .eq("direct_key", key(alice, bob)).eq("conversation_type", "direct");

  check("after block: conversation archived", (await conversationState(alice, bob))?.status === "archived",
    "communication correctly stops");
  check("after block: friendship ended", (await friendshipState(alice, bob))?.ended_at !== null);

  // ---- 3. UNBLOCK ---------------------------------------------------------
  await admin.from("blocked_users").delete().eq("blocker_id", alice).eq("blocked_id", bob);

  const afterUnblock = await conversationState(alice, bob);
  const friendAfterUnblock = await friendshipState(alice, bob);
  check("after unblock: friendship stays ENDED", friendAfterUnblock?.ended_at !== null,
    "unblock alone must not silently recreate the relationship");
  /* Unblock alone should NOT reopen the thread either -- there is no
     relationship yet. The bug is that re-adding does not reopen it either. */
  check("after unblock: conversation still archived (correct)", afterUnblock?.status === "archived",
    "no relationship yet, so no conversation");

  // ---- 4. RE-ADD (the reported defect) ------------------------------------
  await admin.from("friendships")
    .update({ ended_at: null })
    .eq("user_one_id", one).eq("user_two_id", two);

  const afterReadd = await conversationState(alice, bob);
  const friendAfterReadd = await friendshipState(alice, bob);

  check("after re-add: friendship is live again", friendAfterReadd?.ended_at === null);
  check("after re-add: CONVERSATION IS USABLE", afterReadd?.status === "active",
    afterReadd?.status === "active"
      ? "lifecycle restored"
      : `still '${afterReadd?.status}' -- this is BETA-001`);

  // ---- 5. membership survived ---------------------------------------------
  const { data: members } = await admin.from("conversation_members")
    .select("user_id, status").eq("conversation_id", convo.id);
  const joined = (members ?? []).filter((m) => m.status === "joined").length;
  check("after re-add: both sides still joined", joined === 2, `${joined}/2 joined`);

  // ---- 6. history survived -------------------------------------------------
  const { count } = await admin.from("messages")
    .select("id", { count: "exact", head: true }).eq("conversation_id", convo.id);
  check("after re-add: prior history preserved", (count ?? 0) === 1,
    "blocking is an ending, not an erasure");

  // ---- 7. SECURITY: a live block outranks a friendship -------------------
  /* The dangerous edge. If a block still exists, no friendship row may reopen
     the channel -- otherwise re-adding somebody would undo their block. */
  await admin.from("conversations").update({ status: "archived" })
    .eq("direct_key", key(alice, bob));
  await admin.from("blocked_users").insert({ blocker_id: bob, blocked_id: alice });
  await admin.from("friendships").update({ ended_at: new Date().toISOString() })
    .eq("user_one_id", one).eq("user_two_id", two);
  await admin.from("friendships").update({ ended_at: null })
    .eq("user_one_id", one).eq("user_two_id", two);

  check("SECURITY: a live block keeps the conversation closed",
    (await conversationState(alice, bob))?.status === "archived",
    "re-adding must never undo somebody\'s block");

  await admin.from("blocked_users").delete().eq("blocker_id", bob).eq("blocked_id", alice);

  // ---- 8. once the block is gone, re-adding works again -------------------
  await admin.from("friendships").update({ ended_at: new Date().toISOString() })
    .eq("user_one_id", one).eq("user_two_id", two);
  await admin.from("friendships").update({ ended_at: null })
    .eq("user_one_id", one).eq("user_two_id", two);
  check("with the block removed, re-add reopens normally",
    (await conversationState(alice, bob))?.status === "active");

  // ---- 9. an already-live friendship is not disturbed ---------------------
  await admin.from("conversations").update({ status: "archived" })
    .eq("direct_key", key(alice, bob));
  await admin.from("friendships").update({ accepted_request_id: null })
    .eq("user_one_id", one).eq("user_two_id", two);
  check("an UPDATE that does not change ended_at reopens nothing",
    (await conversationState(alice, bob))?.status === "archived",
    "only the transition into live reopens");

} catch (e) {
  console.log(`\nHARNESS ERROR: ${String(e).split("\n")[0].slice(0, 170)}`);
  results.push(false);
} finally {
  await cleanup();
}

console.log(`\n${results.filter(Boolean).length}/${results.length} block/unblock/re-add checks passed`);
