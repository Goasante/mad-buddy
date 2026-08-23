/**
 * Mission 1 Extremely Advanced — domain 7b: Messages.
 *
 * The missing half of the Safe Arrival + Messages domain. Three properties
 * matter most, and each is enforced somewhere different:
 *
 *  1. **No duplicate sends.** A double tap, a retry after an apparent timeout,
 *     or a client that gave up after the server committed must all produce ONE
 *     message. Enforced by a unique index on (sender_id, client_message_id).
 *  2. **System messages are not user unread.** A lifecycle notice ("Plan
 *     created") must not make the badge claim someone is waiting for a reply.
 *  3. **Membership decides access.** A conversation is readable by its members
 *     and nobody else — proven under RLS as the outsider, not by checking that
 *     the UI declines to render it.
 */
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "http://127.0.0.1:54321";
const SERVICE = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
if (!SUPABASE_URL.includes("127.0.0.1")) throw new Error("refusing to run against a non-local database");
const admin = createClient(SUPABASE_URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });

const QA = "d901121e-688e-477b-b8f0-56c782a16801";
const KOFI = "2a54c81c-acad-4191-b89d-2c427c693c7a";

const results = [];
const check = (name, ok, detail) => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};
const inconclusive = (name, why) => console.log(`INCONC  ${name}  — ${why}`);

const TAG = `seq-msg-${Date.now()}`;
let conversationId = null;

async function cleanup() {
  if (!conversationId) return;
  await admin.from("messages").delete().eq("conversation_id", conversationId);
  await admin.from("conversation_members").delete().eq("conversation_id", conversationId);
  await admin.from("conversations").delete().eq("id", conversationId);
}

// --- Set up a real two-member conversation ---------------------------------
const { data: convo, error: convoError } = await admin.from("conversations")
  .insert({ conversation_type: "direct", created_by: QA, status: "active", direct_key: `${TAG}` })
  .select("id").maybeSingle();

if (convoError || !convo) {
  inconclusive("Messages lifecycle", `could not create a conversation: ${convoError?.message?.slice(0, 130)}`);
} else {
  conversationId = convo.id;
  const { error: memberError } = await admin.from("conversation_members").insert([
    { conversation_id: conversationId, user_id: QA, role: "member", status: "joined" },
    { conversation_id: conversationId, user_id: KOFI, role: "member", status: "joined" }
  ]);
  if (memberError) {
    inconclusive("Messages membership setup", memberError.message.slice(0, 120));
  } else {
    check("a two-member conversation exists", true, "QA + KOFI joined");

    // --- 1. A normal send ------------------------------------------------
    const send = (sender, text, clientId) =>
      admin.from("messages").insert({
        conversation_id: conversationId,
        sender_id: sender,
        message_type: "text",
        text_content: text,
        client_message_id: clientId
      }).select("id").maybeSingle().then((r) => r, (e) => ({ error: e }));

    const first = await send(QA, `${TAG} hello`, crypto.randomUUID());
    check("a message sends", !first.error && Boolean(first.data?.id),
      first.error ? first.error.message.slice(0, 80) : "inserted");

    // --- 2. IDEMPOTENCY: the same client id twice --------------------------
    /* This is the real double-tap / retry-after-timeout shape: the client
       generated ONE id and sent it twice because it never saw the first
       response. */
    const dupId = crypto.randomUUID();
    const [a, b] = await Promise.all([
      send(QA, `${TAG} double`, dupId),
      send(QA, `${TAG} double`, dupId)
    ]);
    const { data: dupRows } = await admin.from("messages")
      .select("id").eq("conversation_id", conversationId).eq("client_message_id", dupId);
    check("the same client_message_id twice yields exactly one message",
      (dupRows ?? []).length === 1,
      `rows ${(dupRows ?? []).length} (inserts ${a.error ? "err" : "ok"}/${b.error ? "err" : "ok"})`);

    // --- 3. A DIFFERENT client id is a genuinely different message ---------
    // Guards the opposite failure: over-deduplicating real repeat messages.
    await send(QA, `${TAG} same text`, crypto.randomUUID());
    await send(QA, `${TAG} same text`, crypto.randomUUID());
    const { data: sameText } = await admin.from("messages")
      .select("id").eq("conversation_id", conversationId).eq("text_content", `${TAG} same text`);
    check("identical text with different client ids stays two messages",
      (sameText ?? []).length === 2, `rows ${(sameText ?? []).length}`);

    // --- 4. System messages must not count as user unread ------------------
    const { error: sysError } = await admin.from("messages").insert({
      conversation_id: conversationId,
      sender_id: null,
      message_type: "system",
      system_event_type: "plan_confirmed",
      text_content: `${TAG} system notice`,
      client_message_id: crypto.randomUUID()
    });
    if (sysError) console.log(`      system insert refused: ${sysError.message.slice(0, 140)}`);
    const { data: systemRows } = await admin.from("messages")
      .select("id, message_type, sender_id").eq("conversation_id", conversationId).eq("message_type", "system");
    check("a system message has no sender, so it cannot read as someone waiting",
      (systemRows ?? []).length === 1 && systemRows[0].sender_id === null,
      `system rows ${(systemRows ?? []).length}, sender ${systemRows?.[0]?.sender_id ?? "null"}`);

    // --- 5. MEMBERSHIP: an outsider cannot read the conversation ----------
    const outsider = createClient(SUPABASE_URL, ANON, { auth: { persistSession: false } });
    const { error: signInError } = await outsider.auth.signInWithPassword({
      email: "saa@local.test", password: "HardeningPass123!"
    });
    if (signInError) {
      inconclusive("Messages membership privacy", `sign-in failed: ${signInError.message.slice(0, 80)}`);
    } else {
      const { data: seen } = await outsider.from("messages")
        .select("id, text_content").eq("conversation_id", conversationId);
      check("a non-member reads ZERO messages from the conversation",
        (seen ?? []).length === 0,
        `rows visible to outsider: ${(seen ?? []).length}`);

      const { data: convoSeen } = await outsider.from("conversations")
        .select("id").eq("id", conversationId);
      check("a non-member cannot read the conversation row itself",
        (convoSeen ?? []).length === 0,
        `conversation rows visible: ${(convoSeen ?? []).length}`);
    }

    // --- 6. MULTI-TAB: membership revoked while a stale tab sends ---------
    /* Tab B removes KOFI from the conversation. Tab A, still holding the open
       thread, sends. The write must not succeed under KOFI's own credentials. */
    await admin.from("conversation_members")
      .update({ status: "left", left_at: new Date().toISOString() })
      .eq("conversation_id", conversationId).eq("user_id", KOFI);

    const removed = createClient(SUPABASE_URL, ANON, { auth: { persistSession: false } });
    const { error: kofiSignIn } = await removed.auth.signInWithPassword({
      email: "kofi@local.test", password: "HardeningPass123!"
    });
    if (kofiSignIn) {
      inconclusive("Messages stale-membership send", `sign-in failed: ${kofiSignIn.message.slice(0, 80)}`);
    } else {
      const { error: staleSend } = await removed.from("messages").insert({
        conversation_id: conversationId,
        sender_id: KOFI,
        message_type: "text",
        text_content: `${TAG} stale send`,
        client_message_id: crypto.randomUUID()
      });
      const { data: landed } = await admin.from("messages")
        .select("id").eq("conversation_id", conversationId).eq("text_content", `${TAG} stale send`);
      check("a removed member's stale tab cannot post into the conversation",
        (landed ?? []).length === 0,
        `rows written: ${(landed ?? []).length} (${staleSend ? "refused" : "ACCEPTED"})`);
    }
  }
}

await cleanup();
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} Messages checks passed`);
