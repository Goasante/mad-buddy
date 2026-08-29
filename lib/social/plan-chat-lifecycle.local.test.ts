import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { actAs, installActingUser, USERS } from "@/lib/test/acting-user";

/**
 * PLAN CHAT LIFECYCLE, against the real local database.
 *
 * Everything here is a database truth, so it is proved by running the real
 * server actions, the real job handler and the real send authorization against
 * the real migrated schema. Nothing asserts on source text: a chat that is
 * "closed" is one the server actually refuses to accept a message into.
 *
 * The shape being proved:
 *
 *   open       -> a member can send
 *   closed     -> the SERVER refuses the send, on every path, however it is
 *                 called; the history stays readable; it leaves the active
 *                 inbox and is findable under Archived
 *   host only  -> only the creator can change the window, and only to one of
 *                 the four offered values
 *   idempotent -> running the closure job twice produces the same state
 */

installActingUser();

/* THE REQUEST-SCOPE BOUNDARY, stubbed for the same reason the session cookie
   is: deliverNotification defers its push round trip with Next's after(),
   which throws outside a real request. Running it inline here is the honest
   substitute -- the notification path still executes for real against the
   database, only the "defer until the response is sent" wrapper is replaced.
   Nothing about closure, authorization or membership is mocked. */
vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>("next/server");
  return { ...actual, after: (callback: () => unknown) => { void callback(); } };
});

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
const DAY_MS = 24 * 60 * 60 * 1000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let admin: any;
let messaging: typeof import("@/lib/messaging/mobile");
let plansActions: typeof import("@/app/(app)/plans-actions");
let handlers: typeof import("@/lib/jobs/handlers");
let service: typeof import("@/lib/messaging/service");

/**
 * A Plan owned by A with B as a going participant, plus its Plan Chat.
 *
 * Built through the canonical reconcile RPC rather than by hand, so membership
 * is exactly what the product would have created.
 */
async function seedPlan(options: {
  startAtMs: number | null;
  endAtMs?: number | null;
  status?: string;
  closeDays?: number;
  createdAtMs?: number;
}) {
  const { data: plan } = await admin
    .from("plans")
    .insert({
      creator_id: USERS.A,
      title: `Lifecycle ${Math.random().toString(36).slice(2, 8)}`,
      plan_type: options.startAtMs === null ? "quick" : "scheduled",
      status: options.status ?? "confirmed",
      start_at: options.startAtMs === null ? null : new Date(options.startAtMs).toISOString(),
      end_at: options.endAtMs == null ? null : new Date(options.endAtMs).toISOString(),
      created_at: new Date(options.createdAtMs ?? Date.now() - 30 * DAY_MS).toISOString(),
      chat_close_days: options.closeDays ?? 3,
      place_type: "decide_in_chat"
    })
    .select("id")
    .single();
  const planId = String(plan?.id);

  await admin.from("plan_participants").insert([
    { plan_id: planId, user_id: USERS.A, role: "host", rsvp_status: "going" },
    { plan_id: planId, user_id: USERS.B, role: "participant", rsvp_status: "going" }
  ]);

  // The canonical path that creates and populates a Plan Chat.
  const { data: conversationId } = await admin.rpc("reconcile_plan_conversation_members", {
    p_plan_id: planId
  });

  return { planId, conversationId: String(conversationId) };
}

/** Sends through the real action, and reports whether the SERVER accepted it. */
async function trySend(userId: string, conversationId: string, text: string) {
  actAs(userId);
  return messaging.sendMessage(userId, {
    conversationId,
    text,
    // Required by sendMessageSchema: the client's dedupe key for retries.
    clientMessageId: `t-${Math.random().toString(36).slice(2, 14)}`
  });
}

async function conversationStatus(conversationId: string): Promise<string | null> {
  const { data } = await admin
    .from("conversations")
    .select("status")
    .eq("id", conversationId)
    .maybeSingle();
  return data?.status ?? null;
}

async function messageCount(conversationId: string): Promise<number> {
  const { count } = await admin
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conversationId);
  return count ?? 0;
}

beforeAll(async () => {
  if (!isLocal) return;
  admin = (await import("@/lib/supabase/admin")).createSupabaseAdminClient();
  messaging = await import("@/lib/messaging/mobile");
  plansActions = await import("@/app/(app)/plans-actions");
  handlers = await import("@/lib/jobs/handlers");
  service = await import("@/lib/messaging/service");

  /* SELF-CLEANING, for the same reason the UpFor handoff suite is: this suite
     creates Plans, the canonical lifecycle caps active Plans per creator, and
     an accumulated fixture eventually fails with PLAN_ACTIVE_LIMIT_REACHED --
     a test-data problem that reads exactly like a product regression. */
  await clearFixturePlans();
});

/* AND CLEAN UP AFTER ITSELF TOO, not only before.
 *
 * Cleaning only on the way in leaves this suite's Plans sitting in the database
 * for whatever runs next -- and the per-creator active-Plan cap is shared, so
 * the victim is a SIBLING suite failing with PLAN_ACTIVE_LIMIT_REACHED for
 * reasons that have nothing to do with it. That is a diagnosis this project has
 * already paid for once. Cleaning at both ends keeps every suite independent of
 * the order they happen to run in. */
afterAll(async () => {
  if (!isLocal) return;
  await clearFixturePlans();
});

/** Removes only what this suite created: its own titled Plans and UpFors. */
async function clearFixturePlans() {
  const { data: stale } = await admin
    .from("plans")
    .select("id, source_hangout_id")
    .eq("creator_id", USERS.A)
    .like("title", "Lifecycle %");
  const staleIds = (stale ?? []).map((row: { id: string }) => row.id);
  const hangoutIds = (stale ?? [])
    .map((row: { source_hangout_id: string | null }) => row.source_hangout_id)
    .filter((id: string | null): id is string => Boolean(id));

  if (staleIds.length > 0) {
    await admin.from("conversations").delete().eq("context_type", "plan").in("context_id", staleIds);
    await admin.from("plans").delete().in("id", staleIds);
  }
  if (hangoutIds.length > 0) {
    await admin.from("hangout_sessions").delete().in("id", hangoutIds);
  }

  /* THE SEND RATE LIMIT IS REAL, AND IT IS NOT WHAT THIS SUITE IS TESTING.
   *
   * messages.send is capped at 30 per minute per user -- correct product
   * behaviour, and it fires for real here because these tests send through the
   * real action. This suite sends roughly twenty messages as one fixture user
   * in a few seconds, so running it twice inside the same minute trips the
   * limit and every "a member CAN send" case fails for a reason that has
   * nothing to do with closure.
   *
   * Clearing the counter for the FIXTURE USERS ONLY is the honest fix: it
   * resets test state, exactly like deleting the fixture Plans above, and
   * changes no rule. The limit itself is left entirely intact -- it is still
   * enforced, still 30 a minute, and any real user is unaffected. */
  await admin
    .from("rate_limits")
    .delete()
    .in("user_id", [USERS.A, USERS.B, USERS.C, USERS.D]);
}

describeLocal("a Plan Chat is open while the Plan is live", () => {
  it("accepts a member's message before the close time", async () => {
    const { conversationId } = await seedPlan({ startAtMs: Date.now() + 2 * DAY_MS });

    const sent = await trySend(USERS.B, conversationId, "See you there");
    expect(sent.ok, `an open Plan Chat refused a member's message: ${sent.message}`).toBe(true);
    expect(await conversationStatus(conversationId)).toBe("active");
  }, DB_TIMEOUT);

  it("gets the default three-day window when the host chose nothing", async () => {
    const { planId } = await seedPlan({ startAtMs: Date.now() + 2 * DAY_MS });
    const { data } = await admin.from("plans").select("chat_close_days").eq("id", planId).maybeSingle();
    expect(data?.chat_close_days).toBe(3);
  }, DB_TIMEOUT);
});

describeLocal("the closure job closes a Plan Chat whose Plan is well over", () => {
  it("archives the conversation and blocks every further send", async () => {
    // Ended eight days ago; the default window is three.
    const { conversationId } = await seedPlan({
      startAtMs: Date.now() - 8 * DAY_MS,
      endAtMs: Date.now() - 8 * DAY_MS + 2 * 60 * 60 * 1000
    });

    const before = await trySend(USERS.B, conversationId, "Before closure");
    expect(before.ok, "the chat was already closed before the job ran").toBe(true);

    await handlers.handleClosePlanChats(admin, {});

    expect(await conversationStatus(conversationId)).toBe("archived");

    /* THE REAL TEST. Not a disabled button -- the server action itself, called
       directly, exactly as an attacker with the conversation id would. */
    const after = await trySend(USERS.B, conversationId, "After closure");
    expect(after.ok, "the server accepted a message into a closed Plan Chat").toBe(false);
  }, DB_TIMEOUT);

  it("blocks the host too, not only participants", async () => {
    const { conversationId } = await seedPlan({ startAtMs: Date.now() - 8 * DAY_MS });
    await handlers.handleClosePlanChats(admin, {});
    const sent = await trySend(USERS.A, conversationId, "Host after closure");
    expect(sent.ok, "the host could still post into their own closed Plan Chat").toBe(false);
  }, DB_TIMEOUT);

  /* EVERY MUTATION PATH, not just plain text. All of them resolve through
     canSendMessage, so this proves the chokepoint really is one. */
  it("refuses media, quick actions and every other send path", async () => {
    const { conversationId } = await seedPlan({ startAtMs: Date.now() - 8 * DAY_MS });
    await handlers.handleClosePlanChats(admin, {});

    const permission = await service.canSendMessage(admin, USERS.B, conversationId);
    expect(permission.allowed, "canSendMessage still allowed a closed Plan Chat").toBe(false);
    expect(permission.reason).toBe("conversation_closed");

    actAs(USERS.B);
    const quickAction = await messaging.sendMessage(USERS.B, {
      conversationId,
      quickActionType: "im_here",
      clientMessageId: `qa-${Math.random().toString(36).slice(2, 14)}`
    });
    expect(quickAction.ok, "a quick action reached a closed Plan Chat").toBe(false);

    const withMedia = await messaging.sendMessage(USERS.B, {
      conversationId,
      text: "photo",
      mediaId: "00000000-0000-4000-8000-000000000001",
      clientMessageId: `md-${Math.random().toString(36).slice(2, 14)}`
    });
    expect(withMedia.ok, "a media send reached a closed Plan Chat").toBe(false);
  }, DB_TIMEOUT);

  it("keeps every message readable after closing", async () => {
    const { conversationId } = await seedPlan({ startAtMs: Date.now() - 8 * DAY_MS });
    await trySend(USERS.A, conversationId, "M1 before closing");
    await trySend(USERS.B, conversationId, "M2 before closing");
    const countBefore = await messageCount(conversationId);
    expect(countBefore).toBeGreaterThanOrEqual(2);

    await handlers.handleClosePlanChats(admin, {});

    // NOTHING DELETED.
    expect(await messageCount(conversationId), "closing deleted messages").toBe(countBefore);

    // AND STILL READABLE BY BOTH MEMBERS.
    actAs(USERS.B);
    const view = await messaging.listMessages(USERS.B, conversationId);
    expect(view.length, "a member lost the history of a closed Plan Chat").toBe(countBefore);
    actAs(USERS.A);
    expect((await messaging.listMessages(USERS.A, conversationId)).length).toBe(countBefore);
  }, DB_TIMEOUT);

  it("leaves the active inbox and stays findable under Archived", async () => {
    const { conversationId } = await seedPlan({ startAtMs: Date.now() - 8 * DAY_MS });
    await handlers.handleClosePlanChats(admin, {});

    // The authority the inbox filters on.
    const { data: preference } = await admin
      .from("conversation_user_preferences")
      .select("archived_at")
      .eq("conversation_id", conversationId)
      .eq("user_id", USERS.B)
      .maybeSingle();
    expect(preference?.archived_at, "a closed Plan Chat was not archived for its member").toBeTruthy();

    /* STILL PRESENT, not gone. listConversations must keep returning it --
       filing it under Archived is the inbox's job, and it cannot file what it
       cannot see. */
    actAs(USERS.B);
    const inbox = await messaging.listConversations(USERS.B);
    const row = inbox.find((conversation) => conversation.id === conversationId);
    expect(row, "a closed Plan Chat vanished from the inbox entirely").toBeTruthy();
    expect(row?.planChatClosed, "the closed chat did not present as closed").toBe(true);
  }, DB_TIMEOUT);

  it("does not touch conversations that are not Plan Chats", async () => {
    const { data: before } = await admin
      .from("conversations")
      .select("id")
      .neq("context_type", "plan")
      .eq("status", "active");
    const activeBefore = (before ?? []).length;

    await handlers.handleClosePlanChats(admin, {});

    const { data: after } = await admin
      .from("conversations")
      .select("id")
      .neq("context_type", "plan")
      .eq("status", "active");
    expect((after ?? []).length, "the closure job archived a non-Plan conversation").toBe(activeBefore);
  }, DB_TIMEOUT);

  /* A PLAN CHAT WHOSE PLAN ROW IS GONE MUST BE LEFT ALONE. The local fixture
     genuinely contains these (earlier suites delete their Plans), so this is
     not a hypothetical. */
  it("leaves an orphaned Plan Chat open rather than closing on a missing row", async () => {
    const { planId, conversationId } = await seedPlan({ startAtMs: Date.now() - 8 * DAY_MS });
    await admin.from("plans").delete().eq("id", planId);

    await handlers.handleClosePlanChats(admin, {});

    expect(
      await conversationStatus(conversationId),
      "a Plan Chat was closed because its Plan row could not be read"
    ).toBe("active");
  }, DB_TIMEOUT);
});

describeLocal("the closure job is idempotent", () => {
  it("produces the same state when run twice", async () => {
    const { conversationId } = await seedPlan({ startAtMs: Date.now() - 8 * DAY_MS });

    const first = await handlers.handleClosePlanChats(admin, {});
    expect(first).toBeGreaterThan(0);
    const { data: afterFirst } = await admin
      .from("conversation_user_preferences")
      .select("archived_at")
      .eq("conversation_id", conversationId)
      .eq("user_id", USERS.B)
      .maybeSingle();

    const second = await handlers.handleClosePlanChats(admin, {});

    // Nothing left to do, and no timestamp rewritten.
    expect(await conversationStatus(conversationId)).toBe("archived");
    const { data: afterSecond } = await admin
      .from("conversation_user_preferences")
      .select("archived_at")
      .eq("conversation_id", conversationId)
      .eq("user_id", USERS.B)
      .maybeSingle();
    expect(afterSecond?.archived_at, "a second run rewrote the archive timestamp").toBe(
      afterFirst?.archived_at
    );
    // The second run may legitimately close OTHER due chats seeded by earlier
    // cases, so what is asserted is that it did not re-close THIS one -- which
    // the unchanged timestamp above already proves.
    expect(typeof second).toBe("number");
  }, DB_TIMEOUT);

  it("does not re-archive a chat the member deliberately un-archived", async () => {
    const { conversationId } = await seedPlan({ startAtMs: Date.now() - 8 * DAY_MS });
    await handlers.handleClosePlanChats(admin, {});

    // The member digs it back out of Archived.
    await admin
      .from("conversation_user_preferences")
      .update({ archived_at: null })
      .eq("conversation_id", conversationId)
      .eq("user_id", USERS.B);

    await handlers.handleClosePlanChats(admin, {});

    const { data } = await admin
      .from("conversation_user_preferences")
      .select("archived_at")
      .eq("conversation_id", conversationId)
      .eq("user_id", USERS.B)
      .maybeSingle();
    expect(data?.archived_at, "the job re-archived a chat the member had restored").toBeNull();
  }, DB_TIMEOUT);
});

describeLocal("only the host governs the window", () => {
  it("lets the host choose each of the four windows", async () => {
    const { planId } = await seedPlan({ startAtMs: Date.now() + 2 * DAY_MS });
    actAs(USERS.A);
    for (const days of [1, 3, 7, 14]) {
      const result = await plansActions.setPlanChatCloseWindowAction({ planId, days });
      expect(result.ok, `the host could not choose ${days} days: ${result.message}`).toBe(true);
      const { data } = await admin.from("plans").select("chat_close_days").eq("id", planId).maybeSingle();
      expect(data?.chat_close_days).toBe(days);
    }
  }, DB_TIMEOUT);

  it("refuses a participant, and changes nothing", async () => {
    const { planId } = await seedPlan({ startAtMs: Date.now() + 2 * DAY_MS, closeDays: 3 });
    actAs(USERS.B);
    const result = await plansActions.setPlanChatCloseWindowAction({ planId, days: 14 });
    expect(result.ok, "a participant changed the Plan Chat window").toBe(false);
    const { data } = await admin.from("plans").select("chat_close_days").eq("id", planId).maybeSingle();
    expect(data?.chat_close_days, "a refused call still wrote to the database").toBe(3);
  }, DB_TIMEOUT);

  it("refuses an unrelated user", async () => {
    const { planId } = await seedPlan({ startAtMs: Date.now() + 2 * DAY_MS, closeDays: 3 });
    actAs(USERS.C);
    const result = await plansActions.setPlanChatCloseWindowAction({ planId, days: 14 });
    expect(result.ok, "an unrelated user changed the Plan Chat window").toBe(false);
    const { data } = await admin.from("plans").select("chat_close_days").eq("id", planId).maybeSingle();
    expect(data?.chat_close_days).toBe(3);
  }, DB_TIMEOUT);

  it("refuses a signed-out caller", async () => {
    const { planId } = await seedPlan({ startAtMs: Date.now() + 2 * DAY_MS, closeDays: 3 });
    actAs(null);
    const result = await plansActions.setPlanChatCloseWindowAction({ planId, days: 14 });
    expect(result.ok).toBe(false);
    const { data } = await admin.from("plans").select("chat_close_days").eq("id", planId).maybeSingle();
    expect(data?.chat_close_days).toBe(3);
  }, DB_TIMEOUT);

  /* FORGERY. The action takes a NUMBER from a closed set -- there is no
     timestamp on the wire -- and anything outside that set is refused before
     a row is touched. */
  it("refuses a forged window, however it is dressed up", async () => {
    const { planId } = await seedPlan({ startAtMs: Date.now() + 2 * DAY_MS, closeDays: 3 });
    actAs(USERS.A);
    const forgeries: unknown[] = [
      { planId, days: 3650 },
      { planId, days: 0 },
      { planId, days: -14 },
      { planId, days: 2 },
      { planId, days: 3.5 },
      { planId, days: "14" },
      { planId, days: null },
      { planId, days: Number.MAX_SAFE_INTEGER },
      // A timestamp, which is the thing this design refuses to accept at all.
      { planId, closesAt: new Date(Date.now() + 3650 * DAY_MS).toISOString() },
      { planId, days: 14, closesAt: new Date(Date.now() + 3650 * DAY_MS).toISOString(), chat_close_days: 3650 }
    ];
    for (const forged of forgeries) {
      const result = await plansActions.setPlanChatCloseWindowAction(forged);
      if (result.ok) {
        // The last case carries a VALID days:14 alongside junk, so acceptance
        // is correct -- but the junk must have been ignored entirely.
        const { data } = await admin.from("plans").select("chat_close_days").eq("id", planId).maybeSingle();
        expect([1, 3, 7, 14], `a forged window was stored: ${JSON.stringify(forged)}`).toContain(
          data?.chat_close_days
        );
      }
      const { data } = await admin.from("plans").select("chat_close_days").eq("id", planId).maybeSingle();
      expect([1, 3, 7, 14]).toContain(data?.chat_close_days);
    }
  }, DB_TIMEOUT);

  /* THE DATABASE IS THE LAST LINE. Even bypassing every action, the check
     constraint refuses a value outside the four. */
  it("cannot store a forged window even with a direct database write", async () => {
    const { planId } = await seedPlan({ startAtMs: Date.now() + 2 * DAY_MS });
    const { error } = await admin.from("plans").update({ chat_close_days: 3650 }).eq("id", planId);
    expect(error, "the database accepted a window outside the offered four").toBeTruthy();
  }, DB_TIMEOUT);
});

describeLocal("the host can extend a chat that already closed", () => {
  it("reopens it when the new window puts the close time ahead", async () => {
    // Ended four days ago with a one-day window: closed.
    const { planId, conversationId } = await seedPlan({
      startAtMs: Date.now() - 4 * DAY_MS,
      closeDays: 1
    });
    await handlers.handleClosePlanChats(admin, {});
    expect(await conversationStatus(conversationId)).toBe("archived");
    expect((await trySend(USERS.B, conversationId, "while closed")).ok).toBe(false);

    actAs(USERS.A);
    const extended = await plansActions.setPlanChatCloseWindowAction({ planId, days: 14 });
    expect(extended.ok, extended.message).toBe(true);

    expect(await conversationStatus(conversationId)).toBe("active");
    const sent = await trySend(USERS.B, conversationId, "after extending");
    expect(sent.ok, "the chat did not actually reopen for sending").toBe(true);
  }, DB_TIMEOUT);

  it("leaves it closed when the new window is still in the past", async () => {
    const { planId, conversationId } = await seedPlan({
      startAtMs: Date.now() - 20 * DAY_MS,
      closeDays: 1
    });
    await handlers.handleClosePlanChats(admin, {});
    expect(await conversationStatus(conversationId)).toBe("archived");

    actAs(USERS.A);
    // 14 days after a plan that ended 20 days ago is still in the past.
    await plansActions.setPlanChatCloseWindowAction({ planId, days: 14 });
    expect(
      await conversationStatus(conversationId),
      "a shorter-than-needed window reopened a chat that is still due to be closed"
    ).toBe("archived");
  }, DB_TIMEOUT);

  /* A PARTICIPANT MUST NOT BE ABLE TO REOPEN A CLOSED CHAT. This is the
     bypass the brief names: rejoin/reopen to get around closure. */
  it("cannot be reopened by a participant", async () => {
    const { planId, conversationId } = await seedPlan({
      startAtMs: Date.now() - 4 * DAY_MS,
      closeDays: 1
    });
    await handlers.handleClosePlanChats(admin, {});

    actAs(USERS.B);
    await plansActions.setPlanChatCloseWindowAction({ planId, days: 14 });
    expect(
      await conversationStatus(conversationId),
      "a participant reopened a closed Plan Chat"
    ).toBe("archived");
    expect((await trySend(USERS.B, conversationId, "sneaking in")).ok).toBe(false);
  }, DB_TIMEOUT);

  /* UN-ARCHIVING YOUR OWN INBOX ROW IS NOT REOPENING THE CHAT. The inbox
     preference is per-user cosmetics; the send gate is the conversation. */
  it("is not reopened by a member clearing their own archive flag", async () => {
    const { conversationId } = await seedPlan({ startAtMs: Date.now() - 8 * DAY_MS });
    await handlers.handleClosePlanChats(admin, {});

    await admin
      .from("conversation_user_preferences")
      .update({ archived_at: null })
      .eq("conversation_id", conversationId)
      .eq("user_id", USERS.B);

    expect(await conversationStatus(conversationId)).toBe("archived");
    const sent = await trySend(USERS.B, conversationId, "un-archived, still closed");
    expect(sent.ok, "un-archiving an inbox row let a member post into a closed chat").toBe(false);
  }, DB_TIMEOUT);
});

describeLocal("an unrelated user is refused throughout", () => {
  it("cannot read or write a Plan Chat, open or closed", async () => {
    const { conversationId } = await seedPlan({ startAtMs: Date.now() - 8 * DAY_MS });
    await trySend(USERS.A, conversationId, "members only");

    actAs(USERS.C);
    expect(await messaging.listMessages(USERS.C, conversationId)).toEqual([]);
    expect((await trySend(USERS.C, conversationId, "outsider, open")).ok).toBe(false);

    await handlers.handleClosePlanChats(admin, {});

    actAs(USERS.C);
    expect(await messaging.listMessages(USERS.C, conversationId)).toEqual([]);
    expect((await trySend(USERS.C, conversationId, "outsider, closed")).ok).toBe(false);
  }, DB_TIMEOUT);
});

describeLocal("cancelling a Plan closes its chat promptly", () => {
  it("closes the chat at cancellation rather than days later", async () => {
    // Starts in two days: nowhere near its natural close time.
    const { planId, conversationId } = await seedPlan({
      startAtMs: Date.now() + 2 * DAY_MS,
      status: "confirmed"
    });
    expect((await trySend(USERS.B, conversationId, "before cancelling")).ok).toBe(true);
    const countBefore = await messageCount(conversationId);

    actAs(USERS.A);
    const cancelled = await plansActions.cancelPlanAction(planId);
    expect(cancelled.ok, cancelled.message).toBe(true);

    expect(
      await conversationStatus(conversationId),
      "cancelling a Plan left its chat open"
    ).toBe("archived");
    expect((await trySend(USERS.B, conversationId, "after cancelling")).ok).toBe(false);

    // CLOSED, NOT DELETED: people still need to read why it was called off.
    expect(await messageCount(conversationId), "cancelling deleted messages").toBe(countBefore);
    actAs(USERS.B);
    expect((await messaging.listMessages(USERS.B, conversationId)).length).toBe(countBefore);
  }, DB_TIMEOUT);

  it("files the cancelled chat under Archived for its members", async () => {
    const { planId, conversationId } = await seedPlan({ startAtMs: Date.now() + 2 * DAY_MS });
    actAs(USERS.A);
    await plansActions.cancelPlanAction(planId);

    const { data } = await admin
      .from("conversation_user_preferences")
      .select("archived_at")
      .eq("conversation_id", conversationId)
      .eq("user_id", USERS.B)
      .maybeSingle();
    expect(data?.archived_at).toBeTruthy();
  }, DB_TIMEOUT);

  it("is not undone by the closure job running afterwards", async () => {
    const { planId, conversationId } = await seedPlan({ startAtMs: Date.now() + 2 * DAY_MS });
    actAs(USERS.A);
    await plansActions.cancelPlanAction(planId);
    await handlers.handleClosePlanChats(admin, {});
    expect(await conversationStatus(conversationId)).toBe("archived");
  }, DB_TIMEOUT);

  it("refuses a participant trying to cancel", async () => {
    const { planId, conversationId } = await seedPlan({ startAtMs: Date.now() + 2 * DAY_MS });
    actAs(USERS.B);
    const result = await plansActions.cancelPlanAction(planId);
    expect(result.ok, "a participant cancelled someone else's Plan").toBe(false);
    expect(await conversationStatus(conversationId)).toBe("active");
  }, DB_TIMEOUT);
});

/* THE JUST-SHIPPED UPFOR HANDOFF MUST INHERIT THIS.
 *
 * A Plan created by converting an UpFor goes through create_plan_lifecycle,
 * not through the plans insert the other cases use. That RPC does not name
 * chat_close_days, so the column default carries the product default -- but
 * "the default should apply" is exactly the kind of assumption that is wrong
 * six months later when somebody adds an explicit column list. These prove it
 * from the outside: convert an UpFor, and check its chat closes like any
 * other. */
describeLocal("an UpFor-converted Plan gets the same lifecycle authority", () => {
  async function convertUpFor(startAtMs: number | null) {
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

    await admin
      .from("hangout_requests")
      .insert([{ hangout_session_id: hangoutId, requester_id: USERS.B, status: "accepted" }]);

    const { data } = await admin.rpc("create_plan_lifecycle", {
      p_actor_id: USERS.A,
      p_request_key: hangoutId,
      p_title: `Lifecycle upfor ${Math.random().toString(36).slice(2, 7)}`,
      p_description: null,
      p_plan_type: startAtMs === null ? "quick" : "scheduled",
      p_start_at: startAtMs === null ? null : new Date(startAtMs).toISOString(),
      p_end_at: null,
      p_timezone: "UTC",
      p_rsvp_deadline: null,
      p_place_type: "decide_in_chat",
      p_custom_place_text: null,
      p_reminder_minutes: null,
      p_category: null,
      p_invitee_ids: [],
      p_initial_going_ids: [],
      p_source_hangout_id: hangoutId,
      p_effective_max_active_plans: 50,
      p_effective_max_participants: 20
    });
    return {
      hangoutId,
      planId: String(data?.[0]?.plan_id),
      conversationId: String(data?.[0]?.conversation_id)
    };
  }

  it("carries the default three-day window", async () => {
    const { planId } = await convertUpFor(Date.now() + 2 * DAY_MS);
    const { data } = await admin.from("plans").select("chat_close_days").eq("id", planId).maybeSingle();
    expect(data?.chat_close_days, "an UpFor-converted Plan got no close window").toBe(3);
  }, DB_TIMEOUT);

  it("has its chat closed by the same job, and blocked by the same gate", async () => {
    const { conversationId } = await convertUpFor(Date.now() - 8 * DAY_MS);
    expect((await trySend(USERS.B, conversationId, "before")).ok).toBe(true);

    await handlers.handleClosePlanChats(admin, {});

    expect(await conversationStatus(conversationId)).toBe("archived");
    expect(
      (await trySend(USERS.B, conversationId, "after")).ok,
      "an UpFor-converted Plan Chat stayed open after its Plan was well over"
    ).toBe(false);
  }, DB_TIMEOUT);

  it("lets its host -- and only its host -- change the window", async () => {
    const { planId } = await convertUpFor(Date.now() + 2 * DAY_MS);

    actAs(USERS.B);
    const asParticipant = await plansActions.setPlanChatCloseWindowAction({ planId, days: 14 });
    expect(asParticipant.ok, "a participant governed an UpFor-converted Plan Chat").toBe(false);

    actAs(USERS.A);
    const asHost = await plansActions.setPlanChatCloseWindowAction({ planId, days: 7 });
    expect(asHost.ok, asHost.message).toBe(true);
    const { data } = await admin.from("plans").select("chat_close_days").eq("id", planId).maybeSingle();
    expect(data?.chat_close_days).toBe(7);
  }, DB_TIMEOUT);

  /* THE SHIPPED SHAPE MUST SURVIVE: one UpFor, one Plan, one Plan Chat. */
  it("still produces exactly one Plan and one Plan Chat", async () => {
    const { hangoutId, planId } = await convertUpFor(Date.now() + 2 * DAY_MS);
    const { data: plans } = await admin.from("plans").select("id").eq("source_hangout_id", hangoutId);
    expect(plans?.length).toBe(1);
    const { data: conversations } = await admin
      .from("conversations")
      .select("id")
      .eq("context_type", "plan")
      .eq("context_id", planId);
    expect(conversations?.length).toBe(1);
  }, DB_TIMEOUT);
}, DB_TIMEOUT);

describeLocal("a rescheduled Plan reschedules its own closure", () => {
  /* THE PROPERTY THAT MADE A DERIVED CLOSE TIME NON-NEGOTIABLE.
     confirmPollAction writes a winning time poll option into plans.start_at,
     so a stored close instant would be stale for exactly those plans. */
  it("keeps the chat open when the Plan moves into the future", async () => {
    const { planId, conversationId } = await seedPlan({
      startAtMs: Date.now() - 8 * DAY_MS,
      closeDays: 3
    });

    // The plan is moved forward, exactly as a resolved time poll would.
    await admin
      .from("plans")
      .update({ start_at: new Date(Date.now() + 5 * DAY_MS).toISOString() })
      .eq("id", planId);

    await handlers.handleClosePlanChats(admin, {});

    expect(
      await conversationStatus(conversationId),
      "the job closed a chat whose Plan had been moved into the future"
    ).toBe("active");
    expect((await trySend(USERS.B, conversationId, "still on")).ok).toBe(true);
  }, DB_TIMEOUT);

  it("closes it once the moved Plan is itself well past", async () => {
    const { planId, conversationId } = await seedPlan({
      startAtMs: Date.now() + 5 * DAY_MS,
      closeDays: 1
    });
    await handlers.handleClosePlanChats(admin, {});
    expect(await conversationStatus(conversationId)).toBe("active");

    // Moved back into the past, past its one-day window.
    await admin
      .from("plans")
      .update({ start_at: new Date(Date.now() - 4 * DAY_MS).toISOString() })
      .eq("id", planId);

    await handlers.handleClosePlanChats(admin, {});
    expect(await conversationStatus(conversationId)).toBe("archived");
  }, DB_TIMEOUT);
});
