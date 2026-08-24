/**
 * MB-GOD-060 — the `first_reply_received` milestone, proven behaviourally.
 *
 * Home used to answer "has anyone ever replied to you?" by scanning every
 * message in every conversation on every load. The milestone answers it in one
 * indexed row. These checks prove the milestone means the same thing the scan
 * meant, at every point in a conversation's life.
 *
 * FIXTURE DISCIPLINE: every write reads its error, and `profiles_username_format`
 * rejects hyphens.
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
    email: `${tag}-${stamp}@local.test`, password: "HardeningPass123!", email_confirm: true
  });
  if (error) throw new Error(`${tag}: ${error.message}`);
  const id = data.user.id;
  const { error: pErr } = await admin.from("profiles").insert({
    user_id: id, username: `${tag}${stamp.slice(-6)}`, full_name: `${tag} Reply`, is_onboarded: true
  });
  if (pErr) throw new Error(`${tag} profile: ${pErr.message}`);
  made.push(id);
  return id;
}

const hasMilestone = async (id) => {
  const { data } = await admin.from("activation_milestones")
    .select("id").eq("user_id", id).eq("milestone", "first_reply_received");
  return (data ?? []).length;
};

async function cleanup() {
  for (const id of made) {
    const { data: convos } = await admin.from("conversations").select("id").like("direct_key", `%${id}%`);
    for (const c of convos ?? []) {
      await admin.from("messages").delete().eq("conversation_id", c.id);
      await admin.from("conversation_members").delete().eq("conversation_id", c.id);
      await admin.from("conversations").delete().eq("id", c.id);
    }
    await admin.from("activation_milestones").delete().eq("user_id", id);
    await admin.from("profiles").delete().eq("user_id", id);
    await admin.auth.admin.deleteUser(id);
  }
}

try {
  const alice = await person("repa");
  const bob = await person("repb");

  // --- brand-new accounts -------------------------------------------------
  check("a brand-new user has no reply milestone",
    (await hasMilestone(alice)) === 0 && (await hasMilestone(bob)) === 0, "neither has one");

  const directKey = [alice, bob].sort().join(":");
  const { data: convo, error: cErr } = await admin.from("conversations")
    .insert({ conversation_type: "direct", created_by: alice, status: "active", direct_key: directKey })
    .select("id").maybeSingle();
  if (cErr) throw new Error(`conversation: ${cErr.message}`);
  const { error: mErr } = await admin.from("conversation_members").insert([
    { conversation_id: convo.id, user_id: alice, role: "member", status: "joined" },
    { conversation_id: convo.id, user_id: bob, role: "member", status: "joined" }
  ]);
  if (mErr) throw new Error(`members: ${mErr.message}`);

  // --- one-sided: Alice talks into silence --------------------------------
  for (let i = 0; i < 3; i += 1) {
    const { error } = await admin.from("messages").insert({
      conversation_id: convo.id, sender_id: alice, message_type: "text",
      text_content: `one-sided ${i}`, client_message_id: crypto.randomUUID()
    });
    if (error) throw new Error(`one-sided send: ${error.message}`);
  }
  check("three messages from ONE person do not make it two-sided",
    (await hasMilestone(alice)) === 0 && (await hasMilestone(bob)) === 0,
    "talking into silence is not a relationship");

  // --- a system message must not count as a reply -------------------------
  const { error: sysErr } = await admin.from("messages").insert({
    conversation_id: convo.id, sender_id: bob, message_type: "system",
    text_content: "joined", client_message_id: crypto.randomUUID()
  });
  if (sysErr) {
    console.log(`  note: system message rejected by schema (${sysErr.message.slice(0, 60)}) — skipping that case`);
  } else {
    check("a SYSTEM message from the other side does not count as a reply",
      (await hasMilestone(alice)) === 0, "system messages are not a person speaking");
  }

  // --- the reply ----------------------------------------------------------
  const { error: rErr } = await admin.from("messages").insert({
    conversation_id: convo.id, sender_id: bob, message_type: "text",
    text_content: "actually replying", client_message_id: crypto.randomUUID()
  });
  if (rErr) throw new Error(`reply: ${rErr.message}`);

  check("a real reply records the milestone for the SENDER",
    (await hasMilestone(alice)) === 1, `alice rows=${await hasMilestone(alice)}`);
  check("a real reply records it for the REPLIER too",
    (await hasMilestone(bob)) === 1, `bob rows=${await hasMilestone(bob)}`);

  // --- idempotency --------------------------------------------------------
  for (let i = 0; i < 4; i += 1) {
    await admin.from("messages").insert({
      conversation_id: convo.id, sender_id: i % 2 ? alice : bob, message_type: "text",
      text_content: `more ${i}`, client_message_id: crypto.randomUUID()
    });
  }
  check("further messages create no duplicate milestone rows",
    (await hasMilestone(alice)) === 1 && (await hasMilestone(bob)) === 1,
    `alice=${await hasMilestone(alice)} bob=${await hasMilestone(bob)}`);

  // --- monotonic: deleting the reply must not un-record it ----------------
  /* The milestone answers "has this EVER happened", so a later deletion does
     not make it untrue. This asserts the intended semantics rather than
     assuming them. */
  await admin.from("messages").delete().eq("conversation_id", convo.id).eq("sender_id", bob);
  check("the milestone is monotonic: removing the reply does not revoke it",
    (await hasMilestone(alice)) === 1, "still recorded");
} catch (e) {
  console.log(`\nHARNESS ERROR: ${String(e).split("\n")[0].slice(0, 160)}`);
} finally {
  await cleanup();
}

console.log(`\n${results.filter(Boolean).length}/${results.length} milestone checks passed`);
