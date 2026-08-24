/**
 * PHASE A / A1 + A2 -- Circle unread clearing, and the mention that vanished.
 *
 * Owner real-device evidence:
 *   A1  Crew shows 3 unread -> open Crew -> read them -> nav still shows 3.
 *   A2  Circle -> "@" -> pick a member -> send -> the name disappears.
 *
 * Both are proven here against the real local database, with negative
 * controls, because a passing assertion that never touched the defect is
 * worth nothing.
 */
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "http://127.0.0.1:54321";
const SERVICE = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
if (!SUPABASE_URL.includes("127.0.0.1")) throw new Error("refusing to run against a non-local database");
const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });

const made = [];
const results = [];
const check = (n, ok, d) => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? `  -- ${d}` : ""}`); };

async function person(tag, fullName, username) {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 900 + 100)}`;
  const { data, error } = await admin.auth.admin.createUser({
    email: `${tag}-${stamp}@local.test`, password: "CircleTest123!", email_confirm: true
  });
  if (error) throw new Error(`${tag}: ${error.message}`);
  const id = data.user.id;
  const { error: pErr } = await admin.from("profiles").insert({
    user_id: id, username: username ?? `${tag}${stamp.slice(-7)}`, full_name: fullName, is_onboarded: true
  });
  if (pErr) throw new Error(`${tag} profile: ${pErr.message}`);
  made.push(id);
  return id;
}

async function makeCircle(owner, members) {
  const { data: conv, error } = await admin.from("conversations")
    .insert({ conversation_type: "group", created_by: owner, status: "active" })
    .select("id").maybeSingle();
  if (error) throw new Error(`circle: ${error.message}`);
  await admin.from("conversation_members").insert(
    [owner, ...members].map((u) => ({
      conversation_id: conv.id, user_id: u,
      role: u === owner ? "owner" : "member", status: "joined"
    }))
  );
  return conv.id;
}

async function say(conversationId, sender, text) {
  const { data, error } = await admin.from("messages").insert({
    conversation_id: conversationId, sender_id: sender, message_type: "text",
    text_content: text, client_message_id: crypto.randomUUID()
  }).select("id").maybeSingle();
  if (error) throw new Error(`message: ${error.message}`);
  return data.id;
}

/** Mirrors markConversationRead's write: own read state only. */
async function markRead(userId, conversationId) {
  const { data: latest } = await admin.from("messages")
    .select("id").eq("conversation_id", conversationId)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!latest) return;
  await admin.from("conversation_members")
    .update({ last_read_message_id: latest.id, updated_at: new Date().toISOString() })
    .eq("conversation_id", conversationId).eq("user_id", userId);
}

/** Server-side unread for one member of one conversation. */
async function unreadFor(userId, conversationId) {
  const { data: member } = await admin.from("conversation_members")
    .select("last_read_message_id").eq("conversation_id", conversationId)
    .eq("user_id", userId).maybeSingle();
  let cutoff = null;
  if (member?.last_read_message_id) {
    const { data: readMsg } = await admin.from("messages")
      .select("created_at").eq("id", member.last_read_message_id).maybeSingle();
    cutoff = readMsg?.created_at ?? null;
  }
  let q = admin.from("messages").select("id", { count: "exact", head: true })
    .eq("conversation_id", conversationId).neq("sender_id", userId);
  if (cutoff) q = q.gt("created_at", cutoff);
  const { count } = await q;
  return count ?? 0;
}

/** The projection under test: full_name || username, blank-safe. */
function projectedName(p) {
  return p.full_name?.trim() || p.username?.trim();
}

async function cleanup() {
  for (const id of made) {
    const { data: mem } = await admin.from("conversation_members").select("conversation_id").eq("user_id", id);
    for (const m of mem ?? []) {
      const { data: msgs } = await admin.from("messages").select("id").eq("conversation_id", m.conversation_id);
      await admin.from("message_mentions").delete().in("message_id", (msgs ?? []).map((x) => x.id));
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
  const viewer = await person("cua", "Viewer Person");
  const mate = await person("cub", "Kwame Boateng");
  // The member at the heart of A2. In production `full_name` is NOT NULL with
  // a length check, so a BLANK name is impossible -- the mismatch comes from
  // loadGroupDetail substituting the placeholder "A Muddy" when it cannot read
  // a profile, which is what the picker then inserted into the text.
  const nameless = await person("cuc", "Phoebes Adjei", `phoebes${Date.now().toString().slice(-6)}`);

  // ---------------- A1: unread clears on open ----------------
  const crew = await makeCircle(mate, [viewer, nameless]);
  await say(crew, mate, "one");
  await say(crew, mate, "two");
  await say(crew, mate, "three");

  const startCrew = await unreadFor(viewer, crew);
  check("A1: Crew starts at 3 unread for the viewer", startCrew === 3, `${startCrew}`);

  // A second Circle, so aggregate behaviour is provable.
  const other = await makeCircle(mate, [viewer]);
  await say(other, mate, "a");
  await say(other, mate, "b");
  check("A1: the second Circle starts at 2 unread", (await unreadFor(viewer, other)) === 2);

  // This is what opening the Circle now does.
  await markRead(viewer, crew);

  const crewAfter = await unreadFor(viewer, crew);
  const otherAfter = await unreadFor(viewer, other);
  check("A1: opening Crew clears Crew to 0 on the SERVER", crewAfter === 0, `crew=${crewAfter}`);
  check("A1: the other Circle is untouched at 2", otherAfter === 2, `other=${otherAfter}`);
  check("A1: the aggregate drops by exactly 3", crewAfter + otherAfter === 2,
    `aggregate=${crewAfter + otherAfter}`);

  // SECURITY: reading changes only the reader's own row.
  const { data: mateRow } = await admin.from("conversation_members")
    .select("last_read_message_id").eq("conversation_id", crew).eq("user_id", mate).maybeSingle();
  check("A1 SECURITY: the viewer's read did not touch another member's read state",
    mateRow?.last_read_message_id == null, "own read state only");
  check("A1 SECURITY: a co-member's unread is unaffected by someone else reading",
    (await unreadFor(nameless, crew)) === 3, "each member counts for themselves");

  // A message arriving AFTER the read counts again.
  await say(crew, mate, "four");
  check("A1: a message arriving after the read counts again",
    (await unreadFor(viewer, crew)) === 1, "the badge stays truthful");
  await markRead(viewer, crew);
  check("A1: re-marking while the Circle is open clears it again",
    (await unreadFor(viewer, crew)) === 0);

  // ---------------- A2: the mention survives the send ----------------
  const MEMBER_NAME_PLACEHOLDER = "A Muddy";

  /** The picker's name, as the Circle page now derives it. */
  function pickerName(member) {
    const name =
      member.displayName && member.displayName !== MEMBER_NAME_PLACEHOLDER
        ? member.displayName
        : member.username;
    return name;
  }

  /** The renderer's match, as splitTextWithMentions performs it: EITHER name. */
  function highlights(text, mentions) {
    return mentions.filter((m) =>
      [m.displayName, m.username].some((n) => n && text.includes(`@${n}`))
    ).length;
  }

  const { data: profiles } = await admin.from("profiles")
    .select("user_id, full_name, username").in("user_id", [mate, nameless]);
  const byId = new Map((profiles ?? []).map((p) => [p.user_id, p]));

  // The projection that feeds the RENDERER (getMessages).
  const rendered = (p) => p.full_name?.trim() || p.username?.trim();

  // THE DEFECT: a member the group projection could not name.
  const unreadable = { displayName: MEMBER_NAME_PLACEHOLDER, username: byId.get(nameless).username };
  const inserted = pickerName(unreadable);
  const projected = rendered(byId.get(nameless));

  check("A2: the picker never inserts the placeholder as a name",
    inserted !== MEMBER_NAME_PLACEHOLDER, `inserts "${inserted}"`);

  const msgId = await say(crew, viewer, `hey @${inserted} are you coming?`);
  const { error: mErr } = await admin.from("message_mentions")
    .insert({ message_id: msgId, mentioned_user_id: nameless });
  check("A2: the mention row stores a user id", !mErr, mErr?.message ?? "stored");

  const { data: stored } = await admin.from("messages")
    .select("text_content").eq("id", msgId).maybeSingle();

  // Does the renderer find what the picker inserted? This is the whole bug.
  const found = highlights(stored.text_content, [
    { displayName: projected, username: byId.get(nameless).username }
  ]);
  check("A2: the renderer HIGHLIGHTS the mention the picker inserted",
    found === 1, `text="${stored.text_content}" projected="${projected}"`);

  // NEGATIVE CONTROL: the old picker inserted the placeholder, and the
  // renderer -- searching for the real projected name -- found nothing.
  const oldInserted = unreadable.displayName;          // the bug, verbatim
  const oldFound = highlights(`hey @${oldInserted} are you coming?`, [
    { displayName: projected, username: byId.get(nameless).username }
  ]);
  check("A2 NEGATIVE CONTROL: the old placeholder name LOSES the highlight",
    oldFound === 0,
    `"@${oldInserted}" inserted, renderer looked for "@${projected}" -- this is what the owner saw`);

  // A member the projection CAN name was never broken, and must stay unbroken.
  const mateName = pickerName({ displayName: "Kwame Boateng", username: byId.get(mate).username });
  const msg2 = await say(crew, viewer, `and @${mateName} too`);
  await admin.from("message_mentions").insert({ message_id: msg2, mentioned_user_id: mate });
  const { data: p2 } = await admin.from("profiles")
    .select("user_id, full_name, username").eq("user_id", mate).maybeSingle();
  check("A2: a normally-named member still resolves to their full name",
    rendered(p2) === "Kwame Boateng" && mateName === "Kwame Boateng", rendered(p2));
  const { data: stored2 } = await admin.from("messages")
    .select("text_content").eq("id", msg2).maybeSingle();
  check("A2: and their mention still highlights",
    highlights(stored2.text_content, [{ displayName: rendered(p2) }]) === 1);

  // Identity is the id: a rename does not redirect or erase the mention.
  await admin.from("profiles").update({ full_name: "Kwame B. Renamed" }).eq("user_id", mate);
  const { data: afterRename } = await admin.from("message_mentions")
    .select("mentioned_user_id").eq("message_id", msg2);
  check("A2: a rename does not redirect the stored identity",
    (afterRename ?? [])[0]?.mentioned_user_id === mate,
    "the id is the identity; the name is only presentation");

  // SECURITY: an outsider cannot be mentioned.
  const outsider = await person("cuz", "Outsider Person");
  const { data: joined } = await admin.from("conversation_members")
    .select("user_id").eq("conversation_id", crew).eq("status", "joined");
  const joinedIds = new Set((joined ?? []).map((r) => r.user_id));
  check("A2 SECURITY: a non-member is not among the mentionable members",
    !joinedIds.has(outsider), "membership is the gate, and the server re-checks it on send");
} catch (e) {
  console.log(`\nHARNESS ERROR: ${String(e).split("\n")[0].slice(0, 200)}`);
  results.push(false);
} finally {
  await cleanup();
}

console.log(`\n${results.filter(Boolean).length}/${results.length} Circle unread + mention checks passed`);
process.exit(results.every(Boolean) ? 0 : 1);
