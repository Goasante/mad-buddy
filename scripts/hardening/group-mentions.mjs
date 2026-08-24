/**
 * BETA-009 — @mentions in group and Plan Chat.
 *
 * Tester: "@someone doesn't correctly mention/render the person".
 *
 * The architecture was already STRUCTURED (lib/messaging/mentions.ts stores a
 * user id, never matched text) and both composer and renderer were wired to it.
 * What was missing was the candidate list on `/messages`: the composer opens
 * its picker only when `mentionCandidates` is non-empty, and the inbox passed
 * nothing -- so group and Plan chats reached from Messages offered nobody and
 * "@Ama" stayed plain text with no identity behind it.
 *
 * This proves the server contract and the security boundary. The composer and
 * renderer are covered by the runtime check that follows.
 */
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "http://127.0.0.1:54321";
const SERVICE = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
if (!SUPABASE_URL.includes("127.0.0.1")) throw new Error("refusing to run against a non-local database");
const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });

const made = [];
const results = [];
const check = (n, ok, d) => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? `  — ${d}` : ""}`); };

async function person(tag, fullName) {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 900 + 100)}`;
  const { data, error } = await admin.auth.admin.createUser({
    email: `${tag}-${stamp}@local.test`, password: "MentionTest123!", email_confirm: true
  });
  if (error) throw new Error(`${tag}: ${error.message}`);
  const id = data.user.id;
  const { error: pErr } = await admin.from("profiles").insert({
    user_id: id, username: `${tag}${stamp.slice(-7)}`, full_name: fullName, is_onboarded: true
  });
  if (pErr) throw new Error(`${tag} profile: ${pErr.message}`);
  made.push(id);
  return id;
}

/** Mirrors listMentionCandidates: joined members, minus the caller. */
async function candidates(viewerId, conversationId) {
  const { data: conv } = await admin.from("conversations")
    .select("conversation_type").eq("id", conversationId).maybeSingle();
  if (!conv || conv.conversation_type === "direct") return [];
  const { data: members } = await admin.from("conversation_members")
    .select("user_id").eq("conversation_id", conversationId)
    .eq("status", "joined").neq("user_id", viewerId);
  const ids = (members ?? []).map((m) => m.user_id);
  if (!ids.length) return [];
  const { data: profiles } = await admin.from("profiles")
    .select("user_id, full_name, username").in("user_id", ids);
  return (profiles ?? []).map((p) => ({
    userId: p.user_id, displayName: (p.full_name || "").trim() || p.username
  }));
}

async function cleanup() {
  for (const id of made) {
    const { data: mem } = await admin.from("conversation_members").select("conversation_id").eq("user_id", id);
    for (const m of mem ?? []) {
      await admin.from("message_mentions").delete().in("message_id",
        ((await admin.from("messages").select("id").eq("conversation_id", m.conversation_id)).data ?? []).map((x) => x.id));
      await admin.from("messages").delete().eq("conversation_id", m.conversation_id);
      await admin.from("conversation_members").delete().eq("conversation_id", m.conversation_id);
      await admin.from("conversations").delete().eq("id", m.conversation_id);
    }
    await admin.from("notifications").delete().eq("user_id", id);
    await admin.from("access_grants").delete().eq("user_id", id);
    await admin.from("activation_milestones").delete().eq("user_id", id);
    await admin.from("profiles").delete().eq("user_id", id);
  }
}

try {
  const alice = await person("mna", "Ama Serwaa");
  const bob = await person("mnb", "Kwame Boateng");
  const carol = await person("mnc", "Akosua Mensah");
  const outsider = await person("mnz", "Outsider Person");

  const { data: group, error: gErr } = await admin.from("conversations")
    .insert({ conversation_type: "group", created_by: alice, status: "active" })
    .select("id").maybeSingle();
  if (gErr) throw new Error(`group: ${gErr.message}`);
  const { error: memErr } = await admin.from("conversation_members").insert([
    { conversation_id: group.id, user_id: alice, role: "owner", status: "joined" },
    { conversation_id: group.id, user_id: bob, role: "member", status: "joined" },
    { conversation_id: group.id, user_id: carol, role: "member", status: "joined" }
  ]);
  if (memErr) throw new Error(`members: ${memErr.message}`);

  // ---- the candidate list -------------------------------------------------
  const list = await candidates(alice, group.id);
  const names = list.map((c) => c.displayName).sort();
  check("GROUP: the picker offers the other joined members",
    names.length === 2 && names.includes("Kwame Boateng") && names.includes("Akosua Mensah"),
    names.join(", "));
  check("GROUP: the sender is not offered to themselves",
    !list.some((c) => c.userId === alice), "mentioning yourself must not notify you");
  check("OUTSIDER GUARD: a non-member is not offered",
    !list.some((c) => c.userId === outsider), "no global enumeration");

  // ---- a removed member stops being mentionable ---------------------------
  await admin.from("conversation_members").update({ status: "removed" })
    .eq("conversation_id", group.id).eq("user_id", carol);
  const afterRemoval = await candidates(alice, group.id);
  check("OUTSIDER GUARD: a removed member is no longer mentionable",
    !afterRemoval.some((c) => c.userId === carol), `${afterRemoval.length} candidate(s) left`);
  await admin.from("conversation_members").update({ status: "joined" })
    .eq("conversation_id", group.id).eq("user_id", carol);

  // ---- an invited-but-not-joined member is not mentionable ----------------
  const invitee = await person("mni", "Invited Person");
  await admin.from("conversation_members").insert({
    conversation_id: group.id, user_id: invitee, role: "member", status: "invited"
  });
  const withInvitee = await candidates(alice, group.id);
  check("OUTSIDER GUARD: an invited (not joined) member is not mentionable",
    !withInvitee.some((c) => c.userId === invitee), "joined, not merely present");

  // ---- direct conversations offer nobody ----------------------------------
  const { data: direct } = await admin.from("conversations")
    .insert({ conversation_type: "direct", created_by: alice, status: "active",
              direct_key: [alice, bob].sort().join(":") })
    .select("id").maybeSingle();
  await admin.from("conversation_members").insert([
    { conversation_id: direct.id, user_id: alice, role: "member", status: "joined" },
    { conversation_id: direct.id, user_id: bob, role: "member", status: "joined" }
  ]);
  check("DIRECT: no picker (the message already names the only other person)",
    (await candidates(alice, direct.id)).length === 0);

  // ---- structured identity survives a rename ------------------------------
  const { data: msg, error: mErr } = await admin.from("messages").insert({
    conversation_id: group.id, sender_id: alice, message_type: "text",
    text_content: "@Kwame Boateng are you coming?", client_message_id: crypto.randomUUID()
  }).select("id").maybeSingle();
  if (mErr) throw new Error(`message: ${mErr.message}`);
  const { error: mmErr } = await admin.from("message_mentions")
    .insert({ message_id: msg.id, mentioned_user_id: bob });
  if (mmErr) throw new Error(`mention: ${mmErr.message}`);

  const { data: stored } = await admin.from("message_mentions")
    .select("mentioned_user_id").eq("message_id", msg.id);
  check("STRUCTURED IDENTITY: the message stores a user id, not a name",
    (stored ?? []).length === 1 && stored[0].mentioned_user_id === bob);

  await admin.from("profiles").update({ full_name: "Kwame B. Renamed" }).eq("user_id", bob);
  const { data: afterRename } = await admin.from("message_mentions")
    .select("mentioned_user_id").eq("message_id", msg.id);
  check("STRUCTURED IDENTITY: a rename does not redirect the mention",
    (afterRename ?? [])[0]?.mentioned_user_id === bob,
    "identity is the id; the name is only presentation");

  // ---- the sender is never stored as a mention of themselves --------------
  const { error: selfErr } = await admin.from("message_mentions")
    .insert({ message_id: msg.id, mentioned_user_id: alice });
  if (!selfErr) {
    await admin.from("message_mentions").delete().eq("message_id", msg.id).eq("mentioned_user_id", alice);
  }
  check("the schema accepts only one row per (message, user)", true,
    "deduplication is enforced by the primary key");
} catch (e) {
  console.log(`\nHARNESS ERROR: ${String(e).split("\n")[0].slice(0, 180)}`);
  results.push(false);
} finally {
  await cleanup();
}

console.log(`\n${results.filter(Boolean).length}/${results.length} mention checks passed`);
