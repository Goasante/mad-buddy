import { beforeAll, describe, expect, it } from "vitest";

import { USERS } from "@/lib/test/acting-user";

/**
 * UPFOR -> PLAN -> PLAN CHAT, against the real local database.
 *
 * The contracts here are about WHO ends up where: who joins the Plan Chat, who
 * is notified about it, and what a retry does. Those are database truths, so
 * they are exercised against the canonical create_plan_lifecycle RPC rather
 * than asserted from source text.
 *
 * The RPC derives accepted participants from hangout_requests itself when
 * p_source_hangout_id is set -- it does not trust the caller's arrays. These
 * tests pin that behaviour, because it is the thing that stops a client
 * promoting a pending requester into a Plan Chat.
 */

try {
  const fs = await import("node:fs");
  const raw = fs.readFileSync(".env.local", "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
} catch {
  // No .env.local: the isLocal guard below skips the suite.
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const isLocal = /127\.0\.0\.1|localhost/.test(url);
const describeLocal = isLocal ? describe : describe.skip;
const DB_TIMEOUT = 30_000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let admin: any;

/** An UpFor owned by A with one accepted, one pending and one declined answer. */
async function seedUpFor() {
  const { data: session } = await admin
    .from("hangout_sessions")
    .insert({
      owner_id: USERS.A,
      activity_type: "food",
      status: "active",
      starts_at: new Date().toISOString(),
      ends_at: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
      max_participants: 10,
      audience_type: "all_muddies"
    })
    .select("id")
    .single();
  const hangoutId = String(session?.id);

  await admin.from("hangout_requests").insert([
    { hangout_session_id: hangoutId, requester_id: USERS.B, status: "accepted" },
    { hangout_session_id: hangoutId, requester_id: USERS.C, status: "pending" },
    { hangout_session_id: hangoutId, requester_id: USERS.D, status: "declined" }
  ]);

  return hangoutId;
}

async function convert(hangoutId: string, actorId = USERS.A) {
  const { data, error } = await admin.rpc("create_plan_lifecycle", {
    p_actor_id: actorId,
    p_request_key: hangoutId,
    p_title: "Dinner",
    p_description: null,
    p_plan_type: "quick",
    p_start_at: null,
    p_end_at: null,
    p_timezone: "UTC",
    p_rsvp_deadline: null,
    p_place_type: "decide_in_chat",
    p_custom_place_text: null,
    p_reminder_minutes: null,
    p_category: null,
    // Deliberately EMPTY, exactly as lib/plans/service.ts passes them: the RPC
    // must derive participants from the database, not from these.
    p_invitee_ids: [],
    p_initial_going_ids: [],
    p_source_hangout_id: hangoutId,
    p_effective_max_active_plans: 20,
    p_effective_max_participants: 20
  });
  return { row: data?.[0], error };
}

async function conversationMembers(conversationId: string) {
  const { data } = await admin
    .from("conversation_members")
    .select("user_id, status")
    .eq("conversation_id", conversationId)
    .eq("status", "joined");
  return (data ?? []).map((row: { user_id: string }) => row.user_id);
}

beforeAll(async () => {
  if (!isLocal) return;
  admin = (await import("@/lib/supabase/admin")).createSupabaseAdminClient();
});

describeLocal("UpFor conversion puts the right people in the Plan Chat", () => {
  it("admits the owner and accepted participants, and nobody else", async () => {
    const hangoutId = await seedUpFor();
    const { row, error } = await convert(hangoutId);
    expect(error).toBeFalsy();
    expect(row?.conversation_id, "the lifecycle returned no Plan Chat").toBeTruthy();

    const members = await conversationMembers(String(row.conversation_id));
    expect(members).toContain(USERS.A); // owner
    expect(members).toContain(USERS.B); // accepted
    expect(members, "a pending requester reached the Plan Chat").not.toContain(USERS.C);
    expect(members, "a declined requester reached the Plan Chat").not.toContain(USERS.D);
  }, DB_TIMEOUT);

  it("returns the conversation id so the creator can be taken straight there", async () => {
    const hangoutId = await seedUpFor();
    const { row } = await convert(hangoutId);
    // The whole point of §16: the caller must not have to guess a route.
    expect(String(row.conversation_id)).toMatch(/^[0-9a-f-]{36}$/);
    expect(row.created).toBe(true);
  }, DB_TIMEOUT);

  it("is idempotent: a retried conversion reuses the same Plan and chat", async () => {
    const hangoutId = await seedUpFor();
    const first = await convert(hangoutId);
    const second = await convert(hangoutId);

    expect(String(second.row.plan_id)).toBe(String(first.row.plan_id));
    expect(String(second.row.conversation_id)).toBe(String(first.row.conversation_id));
    // `created` is the RPC's own idempotency answer, and it is what gates the
    // Plan Chat notification -- so a retry sends nothing again.
    expect(first.row.created).toBe(true);
    expect(second.row.created, "a retried conversion reported itself as new").toBe(false);

    const { data: plans } = await admin
      .from("plans")
      .select("id")
      .eq("source_hangout_id", hangoutId);
    expect(plans?.length, "the UpFor produced more than one Plan").toBe(1);

    const { data: conversations } = await admin
      .from("conversations")
      .select("id")
      .eq("context_type", "plan")
      .eq("context_id", String(first.row.plan_id));
    expect(conversations?.length, "the Plan grew a second chat").toBe(1);
  }, DB_TIMEOUT);

  /* THE SECURITY SHAPE. A caller cannot promote somebody by claiming they were
     accepted: the arrays are ignored for an UpFor conversion and the database's
     own status is used. */
  it("ignores caller-supplied participants and trusts only stored acceptance", async () => {
    const hangoutId = await seedUpFor();
    const { data, error } = await admin.rpc("create_plan_lifecycle", {
      p_actor_id: USERS.A,
      p_request_key: hangoutId,
      p_title: "Dinner",
      p_description: null,
      p_plan_type: "quick",
      p_start_at: null,
      p_end_at: null,
      p_timezone: "UTC",
      p_rsvp_deadline: null,
      p_place_type: "decide_in_chat",
      p_custom_place_text: null,
      p_reminder_minutes: null,
      p_category: null,
      // A hostile caller asserting the PENDING user is going.
      p_invitee_ids: [USERS.C],
      p_initial_going_ids: [USERS.C],
      p_source_hangout_id: hangoutId,
      p_effective_max_active_plans: 20,
      p_effective_max_participants: 20
    });
    expect(error).toBeFalsy();

    const members = await conversationMembers(String(data?.[0]?.conversation_id));
    expect(
      members,
      "a client-claimed acceptance put a pending user in the Plan Chat"
    ).not.toContain(USERS.C);
    expect(members).toContain(USERS.B);
  }, DB_TIMEOUT);

  it("keeps the Plan Chat pointed at one canonical conversation", async () => {
    const hangoutId = await seedUpFor();
    const { row } = await convert(hangoutId);

    const { data: conversation } = await admin
      .from("conversations")
      .select("id, conversation_type, context_type, context_id")
      .eq("id", String(row.conversation_id))
      .maybeSingle();

    expect(conversation?.conversation_type).toBe("plan");
    expect(conversation?.context_type).toBe("plan");
    expect(String(conversation?.context_id)).toBe(String(row.plan_id));
  }, DB_TIMEOUT);
}, DB_TIMEOUT);
