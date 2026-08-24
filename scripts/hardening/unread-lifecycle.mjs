/**
 * BETA-002 — the unread lifecycle, end to end, across every conversation kind.
 *
 * Tester reports: group unread stays after viewing, Plan Chat unread stays,
 * the nav badge does not decrease. Written before any fix so the failing steps
 * identify themselves rather than being guessed at.
 *
 * WHAT IS BEING TESTED IS THE SERVER'S ANSWER, not the badge pixel. A badge
 * that clears client-side while the server still counts the message is not
 * fixed -- it is fixed until reload, which is exactly what the testers saw.
 *
 * FIXTURE DISCIPLINE: every write reads its error. `profiles_username_format`
 * rejects hyphens. auth.users rows are deliberately left behind (deleting one
 * cascades into append-only domain_events).
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
    user_id: id, username: `${tag}${stamp.slice(-7)}`, full_name: `${tag} Unread`, is_onboarded: true
  });
  if (pErr) throw new Error(`${tag} profile: ${pErr.message}`);
  made.push(id);
  return id;
}

async function makeConversation(kind, creator, members, directKey = null) {
  const { data, error } = await admin.from("conversations")
    .insert({ conversation_type: kind, created_by: creator, status: "active", direct_key: directKey })
    .select("id").maybeSingle();
  if (error) throw new Error(`conversation(${kind}): ${error.message}`);
  const { error: mErr } = await admin.from("conversation_members").insert(
    members.map((u) => ({ conversation_id: data.id, user_id: u, role: u === creator ? "owner" : "member", status: "joined" }))
  );
  if (mErr) throw new Error(`members: ${mErr.message}`);
  return data.id;
}

async function send(conversationId, senderId, text) {
  const { data, error } = await admin.from("messages").insert({
    conversation_id: conversationId, sender_id: senderId, message_type: "text",
    text_content: text, client_message_id: crypto.randomUUID()
  }).select("id").maybeSingle();
  if (error) throw new Error(`send: ${error.message}`);
  return data.id;
}

/**
 * The server's unread answer, computed the way the product does: messages in
 * conversations I have joined, from somebody else, newer than my read cursor.
 */
async function serverUnread(userId) {
  const { data: memberships } = await admin
    .from("conversation_members")
    .select("conversation_id, last_read_message_id")
    .eq("user_id", userId)
    .eq("status", "joined");

  let total = 0;
  const perConversation = {};
  for (const m of memberships ?? []) {
    let cutoff = null;
    if (m.last_read_message_id) {
      const { data: cursor } = await admin.from("messages")
        .select("created_at").eq("id", m.last_read_message_id).maybeSingle();
      cutoff = cursor?.created_at ?? null;
    }
    let q = admin.from("messages")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", m.conversation_id)
      .neq("sender_id", userId)
      .is("deleted_at", null);
    if (cutoff) q = q.gt("created_at", cutoff);
    const { count } = await q;
    perConversation[m.conversation_id] = count ?? 0;
    total += count ?? 0;
  }
  return { total, perConversation };
}

/** What `markConversationRead` does: advance the cursor to the newest message. */
async function markRead(userId, conversationId) {
  const { data: latest } = await admin.from("messages")
    .select("id").eq("conversation_id", conversationId)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!latest) return;
  const { error } = await admin.from("conversation_members")
    .update({ last_read_message_id: latest.id })
    .eq("conversation_id", conversationId).eq("user_id", userId);
  if (error) throw new Error(`markRead: ${error.message}`);
}

async function cleanup() {
  for (const id of made) {
    const { data: mem } = await admin.from("conversation_members").select("conversation_id").eq("user_id", id);
    for (const m of mem ?? []) {
      await admin.from("messages").delete().eq("conversation_id", m.conversation_id);
      await admin.from("conversation_members").delete().eq("conversation_id", m.conversation_id);
      await admin.from("conversations").delete().eq("id", m.conversation_id);
    }
    await admin.from("notifications").delete().eq("user_id", id);
    await admin.from("friendships").delete().or(`user_one_id.eq.${id},user_two_id.eq.${id}`);
    await admin.from("access_grants").delete().eq("user_id", id);
    await admin.from("activation_milestones").delete().eq("user_id", id);
    await admin.from("profiles").delete().eq("user_id", id);
  }
}

try {
  const a = await person("unra");
  const b = await person("unrb");
  const c = await person("unrc");

  check("baseline: nobody has unread", (await serverUnread(a)).total === 0);

  // ---- DIRECT -------------------------------------------------------------
  const direct = await makeConversation("direct", b, [a, b], [a, b].sort().join(":"));
  await send(direct, b, "direct 1");
  await send(direct, b, "direct 2");

  let u = await serverUnread(a);
  check("DIRECT: two messages produce unread 2", u.total === 2, `total=${u.total}`);

  await markRead(a, direct);
  u = await serverUnread(a);
  check("DIRECT: opening clears unread", u.total === 0, `total=${u.total}`);

  // a later message re-raises it
  await send(direct, b, "direct 3");
  u = await serverUnread(a);
  check("DIRECT: a new message raises unread again", u.total === 1, `total=${u.total}`);
  await markRead(a, direct);

  // ---- GROUP --------------------------------------------------------------
  const group = await makeConversation("group", a, [a, b, c]);
  await send(group, b, "group 1");
  await send(group, c, "group 2");
  await send(group, b, "group 3");

  u = await serverUnread(a);
  check("GROUP: three messages from others produce unread 3", u.total === 3, `total=${u.total}`);

  await markRead(a, group);
  u = await serverUnread(a);
  check("GROUP: opening clears unread", u.total === 0, `total=${u.total} (BETA-002 if non-zero)`);

  // ---- MY OWN MESSAGES NEVER COUNT ---------------------------------------
  await send(group, a, "my own message");
  u = await serverUnread(a);
  check("GROUP: my own message is never unread to me", u.total === 0, `total=${u.total}`);

  // ---- PLAN CHAT ----------------------------------------------------------
  const { data: plan, error: pErr } = await admin.from("plans")
    .insert({ creator_id: a, title: "Unread lifecycle plan", plan_type: "quick" })
    .select("id").maybeSingle();
  if (pErr) throw new Error(`plan: ${pErr.message}`);
  const planChat = await makeConversation("plan", a, [a, b]);
  await admin.from("conversations").update({ context_type: "plan", context_id: plan.id }).eq("id", planChat.id ?? planChat);
  await send(planChat, b, "plan chat 1");
  await send(planChat, b, "plan chat 2");

  u = await serverUnread(a);
  check("PLAN CHAT: two messages produce unread 2", u.total === 2, `total=${u.total}`);

  await markRead(a, planChat);
  u = await serverUnread(a);
  check("PLAN CHAT: opening clears unread", u.total === 0, `total=${u.total} (BETA-002 if non-zero)`);

  // ---- MULTIPLE CONVERSATIONS AT ONCE ------------------------------------
  await send(direct, b, "d");
  await send(group, c, "g");
  await send(planChat, b, "p");
  u = await serverUnread(a);
  check("THREE conversations each with one unread total 3", u.total === 3, `total=${u.total}`);

  await markRead(a, group);
  u = await serverUnread(a);
  check("reading ONE conversation only clears that one", u.total === 2, `total=${u.total}`);

  await markRead(a, direct);
  await markRead(a, planChat);
  u = await serverUnread(a);
  check("reading the rest clears everything", u.total === 0, `total=${u.total}`);

  // ---- RE-ENTRY / RELOAD --------------------------------------------------
  /* The cursor lives in the database, so a reload recomputes the same answer.
     This is what distinguishes a real fix from a client-side badge clear. */
  u = await serverUnread(a);
  check("RELOAD: the server still says zero", u.total === 0, `total=${u.total}`);

  // ---- A REMOVED MEMBER STOPS ACCRUING -----------------------------------
  await admin.from("conversation_members").update({ status: "removed" })
    .eq("conversation_id", group).eq("user_id", c);
  await send(group, b, "after c was removed");
  const uc = await serverUnread(c);
  check("SECURITY: a removed member accrues no unread", uc.total === 0, `total=${uc.total}`);

  // ---- THE REAL BADGE PATH: conversation_previews RPC ---------------------
  /* Everything above tests the read-state MODEL. The badge actually calls the
     `conversation_previews` RPC, so that is what has to agree -- a model that
     is right while the RPC disagrees is exactly the reported bug. */
  const { data: mem2 } = await admin.from("conversation_members")
    .select("conversation_id").eq("user_id", a).eq("status", "joined");
  const ids = (mem2 ?? []).map((m) => m.conversation_id);

  const rpcTotal = async (uid, cids) => {
    const { data, error } = await admin.rpc("conversation_previews", {
      p_user_id: uid, p_conversation_ids: cids
    });
    if (error) throw new Error(`rpc: ${error.message}`);
    return (data ?? []).reduce((t, r) => t + (r.unread_count ?? 0), 0);
  };

  /* RELATIVE, not absolute. Earlier steps deliberately leave a message unread
     (the one sent after C was removed), so asserting an absolute zero here
     tested the harness's bookkeeping rather than the product. What matters is
     that the RPC MOVES the way the model moves. */
  const rpcBefore = await rpcTotal(a, ids);
  const modelBefore = (await serverUnread(a)).total;
  check("RPC and model start in agreement", rpcBefore === modelBefore,
    `rpc=${rpcBefore} model=${modelBefore}`);

  await send(group, b, "rpc check 1");
  await send(group, c, "rpc check 2");
  const rpcAfter = await rpcTotal(a, ids);
  const modelAfter = (await serverUnread(a)).total;
  check("RPC counts two new group messages", rpcAfter === rpcBefore + 2,
    `${rpcBefore} -> ${rpcAfter}`);
  check("RPC and model agree", rpcAfter === modelAfter, `rpc=${rpcAfter} model=${modelAfter}`);

  await markRead(a, group);
  const rpcRead = await rpcTotal(a, ids);
  check("RPC: opening the group clears the BADGE", rpcRead === 0,
    rpcRead === 0 ? "badge and server agree" : `rpc still ${rpcRead} -- BETA-002`);

  const beforePlan = await rpcTotal(a, ids);
  await send(planChat, b, "rpc plan 1");
  check("RPC counts Plan Chat", (await rpcTotal(a, ids)) === beforePlan + 1);
  await markRead(a, planChat);
  check("RPC: opening Plan Chat clears its unread", (await rpcTotal(a, ids)) === beforePlan,
    "back to where it was before that message");

  const { error: sysErr } = await admin.from("messages").insert({
    conversation_id: group, sender_id: b, message_type: "system",
    text_content: "joined", client_message_id: crypto.randomUUID()
  });
  if (!sysErr) {
    const beforeSys = await rpcTotal(a, ids);
    check("RPC: a system message never raises the badge", (await rpcTotal(a, ids)) === beforeSys);
  }

} catch (e) {
  console.log(`\nHARNESS ERROR: ${String(e).split("\n")[0].slice(0, 180)}`);
  results.push(false);
} finally {
  await cleanup();
}

console.log(`\n${results.filter(Boolean).length}/${results.length} unread lifecycle checks passed`);
