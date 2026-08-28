import { beforeAll, describe, expect, it } from "vitest";

import { actAs, installActingUser, USERS, CONVERSATIONS, ABSENT_UUID } from "@/lib/test/acting-user";

/**
 * CHATS V4 SERVER-ACTION BEHAVIOURAL PROOF.
 *
 * Executes the real server actions against the real local migrated Postgres.
 * Only the session-cookie boundary is stubbed (see lib/test/acting-user.ts);
 * membership, RLS, ownership, retention and media authorization all run for
 * real, because those are precisely what is being proven.
 *
 * Skips itself entirely unless pointed at localhost, so it can never touch
 * production. Requires scripts/seed-chats-v4-fixture.sql to have run.
 *
 * The assertions are deliberately about OBSERVABLE CONTRACTS -- "an unrelated
 * user cannot read A's Saved state", "expired media receives no signed URL" --
 * rather than about which helper a function happens to call, so they survive
 * refactoring.
 */

installActingUser();

/* Load .env.local the way `next start` does, so this suite can be run with a
   bare `vitest` and still reach the LOCAL stack. Never invents values: if the
   file is absent the suite skips rather than guessing at a database. */
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

/* These tests make real database and storage round trips, so the 5s default is
   too tight once the whole suite runs in parallel. Applied per SUITE rather
   than per test, so a newly added test cannot silently miss it. */
const DB_TIMEOUT = 30_000;

/* Untyped on purpose. The generated Database type intentionally still matches
   production until the three pending migrations are applied and types are
   regenerated, so tables and columns this suite legitimately exercises
   (kept_at, media_mode, conversation_message_pins, saved_messages, ...) are not
   in it yet. Using the same untyped view the V4 actions use is honest; hand-
   writing generated definitions to silence tsc would not be. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let admin: any;
let ultimate: typeof import("@/app/(app)/messaging-ultimate-actions");
let insights: typeof import("@/app/(app)/messaging-v4-insights-actions");
let richMedia: typeof import("@/app/(app)/messaging-rich-media-actions");
let structured: typeof import("@/app/(app)/messaging-structured-share-actions");
let retention: typeof import("@/app/(app)/messaging-retention-v4-actions");
let inbox: typeof import("@/app/(app)/messaging-inbox-v4-actions");
let forward: typeof import("@/app/(app)/messaging-forward-actions");

/** A message A sent in the group, used as the generic "accessible message". */
let GROUP_MESSAGE = "";
/** A message in a conversation C cannot reach, for IDOR probes. */
let DIRECT_MESSAGE = "";


/** Row count via a plain select: unambiguous, no count-header semantics. */
async function rowCount(table: string, filters: Record<string, string>) {
  let query = admin.from(table).select("*");
  for (const [column, value] of Object.entries(filters)) query = query.eq(column, value);
  const { data } = await query;
  return (data ?? []).length;
}

async function seedMessage(conversationId: string, senderId: string, text: string) {
  const { data } = await admin
    .from("messages")
    .insert({
      conversation_id: conversationId,
      sender_id: senderId,
      message_type: "text",
      text_content: text,
      client_message_id: `v4test-${Math.random().toString(36).slice(2, 12)}`
    })
    .select("id")
    .single();
  return String(data?.id);
}

beforeAll(async () => {
  if (!isLocal) return;
  const adminModule = await import("@/lib/supabase/admin");
  admin = adminModule.createSupabaseAdminClient();

  ultimate = await import("@/app/(app)/messaging-ultimate-actions");
  insights = await import("@/app/(app)/messaging-v4-insights-actions");
  richMedia = await import("@/app/(app)/messaging-rich-media-actions");
  structured = await import("@/app/(app)/messaging-structured-share-actions");
  retention = await import("@/app/(app)/messaging-retention-v4-actions");
  inbox = await import("@/app/(app)/messaging-inbox-v4-actions");
  forward = await import("@/app/(app)/messaging-forward-actions");

  GROUP_MESSAGE = await seedMessage(CONVERSATIONS.group, USERS.A, "group fixture message");
  DIRECT_MESSAGE = await seedMessage(CONVERSATIONS.direct, USERS.A, "direct fixture message");
}, DB_TIMEOUT);

/**
 * The baseline every externally callable action must satisfy, expressed once
 * as a matrix rather than as 27 copies of the same three tests.
 */
describeLocal("V4 actions: authentication and IDOR baseline", () => {
  /** Each entry: name, and a call that a signed-out or unrelated user must not complete. */
  function probes() {
    return [
      ["getUltimateConversationStateAction", () => ultimate.getUltimateConversationStateAction(CONVERSATIONS.group)],
      ["heartbeatConversationPresenceAction", () => ultimate.heartbeatConversationPresenceAction({ conversationId: CONVERSATIONS.group, typing: true })],
      ["setSavedMessageAction", () => ultimate.setSavedMessageAction({ messageId: GROUP_MESSAGE, saved: true })],
      ["setPinnedMessageAction", () => ultimate.setPinnedMessageAction({ messageId: GROUP_MESSAGE, pinned: true })],
      ["updateConversationUserPreferencesAction", () => ultimate.updateConversationUserPreferencesAction({ conversationId: CONVERSATIONS.group, archived: true })],
      ["updateConversationChatSettingsAction", () => ultimate.updateConversationChatSettingsAction({ conversationId: CONVERSATIONS.group, whoCanPin: "owner" })],
      ["createChatPollAction", () => ultimate.createChatPollAction({ conversationId: CONVERSATIONS.group, question: "Where?", options: ["A", "B"], clientMessageId: `probe-${Math.random().toString(36).slice(2)}` })],
      ["keepMessageInChatAction(ultimate)", () => ultimate.keepMessageInChatAction(GROUP_MESSAGE, true)],
      ["getMessageInfoAction", () => insights.getMessageInfoAction(GROUP_MESSAGE)],
      ["getChatCollectionsAction", () => insights.getChatCollectionsAction(CONVERSATIONS.group)],
      ["createSavedMessageFolderAction", () => insights.createSavedMessageFolderAction("Attack folder")],
      ["getStructuredShareOptionsAction", () => structured.getStructuredShareOptionsAction(CONVERSATIONS.group)],
      ["getMessageRetentionAction", () => retention.getMessageRetentionAction({ messageId: GROUP_MESSAGE })],
      ["keepMessageInChatAction(retention)", () => retention.keepMessageInChatAction({ messageId: GROUP_MESSAGE })],
      ["getInboxConversationPreferencesAction", () => inbox.getInboxConversationPreferencesAction()],
      ["forwardMessageAction", () => forward.forwardMessageAction({ messageId: GROUP_MESSAGE, conversationIds: [CONVERSATIONS.direct] })],
      ["getRichMediaMessageAction", () => richMedia.getRichMediaMessageAction({ conversationId: CONVERSATIONS.group, messageId: GROUP_MESSAGE })],
      ["createChatRichMediaUploadIntentAction", () => richMedia.createChatRichMediaUploadIntentAction({ conversationId: CONVERSATIONS.group, mediaKind: "file", contentType: "application/pdf", sizeBytes: 1024, fileName: "x.pdf" })]
    ] as Array<[string, () => Promise<unknown>]>;
  }

  /** A refusal is: an explicit failure, or an empty/null projection. Never data. */
  function refused(result: unknown): boolean {
    if (result === null || result === undefined) return true;
    if (Array.isArray(result)) return result.length === 0;
    if (typeof result === "object") {
      const record = result as Record<string, unknown>;
      if ("ok" in record) return record.ok === false;
      // A state projection that leaked nothing is also a refusal.
      return Object.values(record).every(
        (value) => value === null || value === undefined || (Array.isArray(value) && value.length === 0)
      );
    }
    return false;
  }

  it("refuses every action to a signed-out caller", async () => {
    actAs(null);
    for (const [name, call] of probes()) {
      const result = await call();
      expect(refused(result), `${name} served a signed-out caller`).toBe(true);
    }
  });

  it("refuses every action to an authenticated but unrelated user", async () => {
    // C is a real account with a real session and no membership anywhere here.
    // Holding a conversation id or a message id is not authorization.
    actAs(USERS.C);
    for (const [name, call] of probes()) {
      const result = await call();
      expect(refused(result), `${name} served an unrelated user`).toBe(true);
    }
  });

  /**
   * leaveConversationPresence is deliberately NOT in the refusal matrix above.
   * Its delete is scoped to user_id = self, so an unrelated caller clears only
   * their own (nonexistent) presence. Returning ok is correct; what matters is
   * that it cannot clear ANOTHER user's presence.
   */
  it("lets presence-leave be self-scoped without touching anyone else", async () => {
    actAs(USERS.A);
    await ultimate.heartbeatConversationPresenceAction({ conversationId: CONVERSATIONS.group, typing: true });
    const before = await rowCount("conversation_presence", {
      conversation_id: CONVERSATIONS.group,
      user_id: USERS.A
    });
    expect(before).toBe(1);

    // C tries to clear presence on a conversation they cannot even see.
    actAs(USERS.C);
    await ultimate.leaveConversationPresenceAction(CONVERSATIONS.group);

    const after = await rowCount("conversation_presence", {
      conversation_id: CONVERSATIONS.group,
      user_id: USERS.A
    });
    expect(after, "an unrelated caller cleared another user's presence").toBe(1);

    actAs(USERS.A);
    await ultimate.leaveConversationPresenceAction(CONVERSATIONS.group);
    expect(await rowCount("conversation_presence", {
      conversation_id: CONVERSATIONS.group,
      user_id: USERS.A
    })).toBe(0);
  });

  it("refuses a removed member the conversation they lost", async () => {
    // D was removed from the group. Removal has to END access, not merely hide
    // the control in the client.
    actAs(USERS.D);
    expect(refused(await ultimate.getUltimateConversationStateAction(CONVERSATIONS.group))).toBe(true);
    expect(refused(await insights.getChatCollectionsAction(CONVERSATIONS.group))).toBe(true);
    expect(refused(await ultimate.setSavedMessageAction({ messageId: GROUP_MESSAGE, saved: true }))).toBe(true);
    expect(refused(await ultimate.setPinnedMessageAction({ messageId: GROUP_MESSAGE, pinned: true }))).toBe(true);
    expect(refused(await forward.forwardMessageAction({ messageId: GROUP_MESSAGE, conversationIds: [CONVERSATIONS.group] }))).toBe(true);
  });

  it("rejects malformed input safely rather than throwing", async () => {
    actAs(USERS.A);
    const malformed = [
      () => ultimate.getUltimateConversationStateAction("not-a-uuid"),
      () => ultimate.setSavedMessageAction({ messageId: "nope", saved: true }),
      () => ultimate.setPinnedMessageAction({ messageId: 42 as unknown as string, pinned: true }),
      () => ultimate.createChatPollAction({ conversationId: CONVERSATIONS.group, question: "", options: [], clientMessageId: "x3" }),
      () => insights.getMessageInfoAction("../../etc/passwd"),
      () => retention.getMessageRetentionAction({ messageId: null as unknown as string }),
      () => forward.forwardMessageAction({ messageId: GROUP_MESSAGE, conversationIds: ["not-a-uuid"] })
    ];
    for (const call of malformed) {
      const result = await call();
      expect(refused(result)).toBe(true);
    }
  });

  it("refuses ids that are well-formed but name nothing", async () => {
    actAs(USERS.A);
    expect(refused(await ultimate.getUltimateConversationStateAction(ABSENT_UUID))).toBe(true);
    expect(refused(await ultimate.setSavedMessageAction({ messageId: ABSENT_UUID, saved: true }))).toBe(true);
    expect(refused(await insights.getMessageInfoAction(ABSENT_UUID))).toBe(true);
  });
}, DB_TIMEOUT);

describeLocal("Saved messages and folders", () => {
  it("saves and unsaves a message the user can actually see", async () => {
    actAs(USERS.A);
    const saved = await ultimate.setSavedMessageAction({ messageId: GROUP_MESSAGE, saved: true });
    expect(saved.ok).toBe(true);

    const afterSave = await rowCount("saved_messages", { user_id: USERS.A, message_id: GROUP_MESSAGE });
    expect(afterSave).toBe(1);

    // Saving twice must not create a second row -- a double tap is one save.
    await ultimate.setSavedMessageAction({ messageId: GROUP_MESSAGE, saved: true });
    const afterDuplicate = await rowCount("saved_messages", { user_id: USERS.A, message_id: GROUP_MESSAGE });
    expect(afterDuplicate).toBe(1);

    const unsaved = await ultimate.setSavedMessageAction({ messageId: GROUP_MESSAGE, saved: false });
    expect(unsaved.ok).toBe(true);
    const afterUnsave = await rowCount("saved_messages", { user_id: USERS.A, message_id: GROUP_MESSAGE });
    expect(afterUnsave).toBe(0);
  });

  it("keeps one member's Saved state invisible to the other", async () => {
    actAs(USERS.A);
    await ultimate.setSavedMessageAction({ messageId: GROUP_MESSAGE, saved: true });

    // B shares the conversation and still must not see that A saved anything.
    actAs(USERS.B);
    const bView = await insights.getChatCollectionsAction(CONVERSATIONS.group);
    const bSavedIds = (bView?.saved ?? []).map((entry) => entry.messageId);
    expect(bSavedIds).not.toContain(GROUP_MESSAGE);

    actAs(USERS.A);
    const aView = await insights.getChatCollectionsAction(CONVERSATIONS.group);
    expect((aView?.saved ?? []).map((entry) => entry.messageId)).toContain(GROUP_MESSAGE);

    await ultimate.setSavedMessageAction({ messageId: GROUP_MESSAGE, saved: false });
  });

  it("keeps folder names private to their owner", async () => {
    actAs(USERS.A);
    const privateName = `A private folder ${Math.random().toString(36).slice(2, 8)}`;
    const created = await insights.createSavedMessageFolderAction(privateName);
    expect(created.ok).toBe(true);

    actAs(USERS.B);
    const bView = await insights.getChatCollectionsAction(CONVERSATIONS.group);
    const bFolderNames = (bView?.folders ?? []).map((folder) => folder.name);
    expect(bFolderNames).not.toContain(privateName);

    actAs(USERS.A);
    const aView = await insights.getChatCollectionsAction(CONVERSATIONS.group);
    const folder = (aView?.folders ?? []).find((entry) => entry.name === privateName);
    expect(folder).toBeTruthy();

    // Rename, assign, unassign, delete -- the full folder lifecycle.
    const renamed = await insights.renameSavedMessageFolderAction(folder!.id, `${privateName} renamed`);
    expect(renamed.ok).toBe(true);

    await ultimate.setSavedMessageAction({ messageId: GROUP_MESSAGE, saved: true });
    const assigned = await insights.moveSavedMessageToFolderAction(GROUP_MESSAGE, folder!.id);
    expect(assigned.ok).toBe(true);
    const { data: assignedRow } = await admin
      .from("saved_messages")
      .select("folder_id")
      .eq("user_id", USERS.A)
      .eq("message_id", GROUP_MESSAGE)
      .maybeSingle();
    expect(assignedRow?.folder_id).toBe(folder!.id);

    const unassigned = await insights.moveSavedMessageToFolderAction(GROUP_MESSAGE, null);
    expect(unassigned.ok).toBe(true);

    const deleted = await insights.deleteSavedMessageFolderAction(folder!.id);
    expect(deleted.ok).toBe(true);
    await ultimate.setSavedMessageAction({ messageId: GROUP_MESSAGE, saved: false });
  });

  it("stops one user mutating another user's folder", async () => {
    actAs(USERS.A);
    const ownedName = `A only folder ${Math.random().toString(36).slice(2, 8)}`;
    const created = await insights.createSavedMessageFolderAction(ownedName);
    expect(created.ok, `create folder said: ${created.message}`).toBe(true);
    const aView = await insights.getChatCollectionsAction(CONVERSATIONS.group);
    const folderId = (aView?.folders ?? []).find((f) => f.name === ownedName)?.id;
    expect(folderId).toBeTruthy();

    // B holds a real folder id belonging to A. Possession is not ownership.
    //
    // The assertion is on the OUTCOME, not the status code: both writes are
    // scoped `.eq("user_id", self)`, so B's attempt matches zero rows and
    // Postgres reports no error -- the action can legitimately return ok while
    // having changed nothing. What must never happen is A's folder changing.
    actAs(USERS.B);
    await insights.renameSavedMessageFolderAction(folderId!, "Hijacked");
    await insights.deleteSavedMessageFolderAction(folderId!);

    const { data: stillThere } = await admin
      .from("saved_message_folders")
      .select("name, user_id")
      .eq("id", folderId!)
      .maybeSingle();
    expect(stillThere, "B deleted a folder belonging to A").toBeTruthy();
    expect(stillThere!.user_id).toBe(USERS.A);
    expect(stillThere!.name, "B renamed a folder belonging to A").toBe(ownedName);

    // And B still cannot see it in their own collections.
    const bView = await insights.getChatCollectionsAction(CONVERSATIONS.group);
    expect((bView?.folders ?? []).map((f) => f.id)).not.toContain(folderId!);

    actAs(USERS.A);
    await insights.deleteSavedMessageFolderAction(folderId!);
  });

  it("refuses to save a message the user cannot see", async () => {
    // B is not in the direct conversation between A and... itself: use C, who
    // is in nothing, against a message that really exists.
    actAs(USERS.C);
    const result = await ultimate.setSavedMessageAction({ messageId: DIRECT_MESSAGE, saved: true });
    expect(result.ok).toBe(false);
    expect(await rowCount("saved_messages", { user_id: USERS.C })).toBe(0);
  });
}, DB_TIMEOUT);

describeLocal("Message pins", () => {
  it("pins and unpins through the canonical message-pin table", async () => {
    actAs(USERS.A);
    const pinned = await ultimate.setPinnedMessageAction({ messageId: GROUP_MESSAGE, pinned: true });
    expect(pinned.ok).toBe(true);

    const { data: rows } = await admin
      .from("conversation_message_pins")
      .select("message_id, conversation_id, pinned_by")
      .eq("conversation_id", CONVERSATIONS.group);
    expect(rows?.some((row: { message_id: string }) => row.message_id === GROUP_MESSAGE)).toBe(true);
    expect(rows?.find((row: { message_id: string; pinned_by: string }) => row.message_id === GROUP_MESSAGE)?.pinned_by).toBe(USERS.A);

    // Pinning twice is idempotent, not a duplicate row.
    await ultimate.setPinnedMessageAction({ messageId: GROUP_MESSAGE, pinned: true });
    expect(await rowCount("conversation_message_pins", {
      conversation_id: CONVERSATIONS.group,
      message_id: GROUP_MESSAGE
    })).toBe(1);

    const state = await ultimate.getUltimateConversationStateAction(CONVERSATIONS.group);
    expect((state?.pins ?? []).some((pin) => pin.messageId === GROUP_MESSAGE)).toBe(true);

    const unpinned = await ultimate.setPinnedMessageAction({ messageId: GROUP_MESSAGE, pinned: false });
    expect(unpinned.ok).toBe(true);
  });

  /**
   * REGRESSION: conversation_pins is the INBOX pin table (user pins a
   * conversation to the top of their own list). Chats V4 message pinning must
   * never write there -- the two tables mean different things and the inbox one
   * has no message_id, so a regression would silently corrupt inbox pins or
   * fail outright.
   */
  it("never writes message pins into the inbox conversation_pins table", async () => {
    actAs(USERS.A);
    const inboxBefore = await rowCount("conversation_pins", {});

    await ultimate.setPinnedMessageAction({ messageId: GROUP_MESSAGE, pinned: true });

    const inboxAfter = await rowCount("conversation_pins", {});
    expect(inboxAfter).toBe(inboxBefore);

    // And the two tables remain structurally distinct.
    const { error: inboxHasNoMessageId } = await admin
      .from("conversation_pins")
      .select("message_id")
      .limit(1);
    expect(inboxHasNoMessageId).toBeTruthy();

    await ultimate.setPinnedMessageAction({ messageId: GROUP_MESSAGE, pinned: false });
  });

  it("refuses to pin a message from a conversation the caller cannot reach", async () => {
    actAs(USERS.C);
    const result = await ultimate.setPinnedMessageAction({ messageId: GROUP_MESSAGE, pinned: true });
    expect(result.ok).toBe(false);
    expect(await rowCount("conversation_message_pins", { message_id: GROUP_MESSAGE })).toBe(0);
  });
}, DB_TIMEOUT);

describeLocal("Polls", () => {
  it("creates, votes, changes a vote and closes -- all authorized", async () => {
    actAs(USERS.A);
    const question = `Where are we meeting ${Math.random().toString(36).slice(2, 8)}?`;
    const created = await ultimate.createChatPollAction({
      conversationId: CONVERSATIONS.group,
      question,
      options: ["Osu", "Labone"],
      clientMessageId: `poll-${Math.random().toString(36).slice(2, 12)}`
    });
    expect(created.ok, `poll create said: ${created.message}`).toBe(true);

    const state = await ultimate.getUltimateConversationStateAction(CONVERSATIONS.group);
    // Identified by question, not by position: the projection is newest-first
    // and other tests in this file create polls too.
    const poll = (state?.polls ?? []).find((entry) => entry.question === question);
    expect(poll, "the poll just created was not projected back").toBeTruthy();
    expect(poll!.options.length).toBe(2);

    actAs(USERS.B);
    const voted = await ultimate.voteChatPollAction({ pollMessageId: poll!.messageId, optionIds: [poll!.options[0].id] });
    expect(voted.ok, `vote said: ${voted.message}`).toBe(true);

    // Voting again for the other option must MOVE the vote, not add one.
    await ultimate.voteChatPollAction({ pollMessageId: poll!.messageId, optionIds: [poll!.options[1].id] });
    const bVotes = await rowCount("chat_poll_votes", {
      user_id: USERS.B,
      poll_message_id: poll!.messageId
    });
    expect(bVotes, "changing a vote added one instead of moving it").toBe(1);

    // An unrelated user cannot vote using a real poll id.
    actAs(USERS.C);
    const attackVote = await ultimate.voteChatPollAction({ pollMessageId: poll!.messageId, optionIds: [poll!.options[0].id] });
    expect(attackVote.ok).toBe(false);
    const cVotes = await rowCount("chat_poll_votes", {
      user_id: USERS.C,
      poll_message_id: poll!.messageId
    });
    expect(cVotes).toBe(0);

    // A removed member cannot vote either.
    actAs(USERS.D);
    expect((await ultimate.voteChatPollAction({ pollMessageId: poll!.messageId, optionIds: [poll!.options[0].id] })).ok).toBe(false);

    actAs(USERS.A);
    const closed = await ultimate.closeChatPollAction(poll!.messageId);
    expect(closed.ok).toBe(true);
  });

  it("rejects polls with no real choice", async () => {
    actAs(USERS.A);
    expect((await ultimate.createChatPollAction({ conversationId: CONVERSATIONS.group, question: "Q", options: [], clientMessageId: "x1" })).ok).toBe(false);
    expect((await ultimate.createChatPollAction({ conversationId: CONVERSATIONS.group, question: "", options: ["a", "b"], clientMessageId: "x2" })).ok).toBe(false);
  });

  it("refuses an option belonging to a different poll", async () => {
    actAs(USERS.A);
    await ultimate.createChatPollAction({ conversationId: CONVERSATIONS.group, question: "First poll", options: ["x", "y"], clientMessageId: `p1-${Math.random().toString(36).slice(2, 10)}` });
    await ultimate.createChatPollAction({ conversationId: CONVERSATIONS.group, question: "Second poll", options: ["p", "q"], clientMessageId: `p2-${Math.random().toString(36).slice(2, 10)}` });
    const state = await ultimate.getUltimateConversationStateAction(CONVERSATIONS.group);
    const polls = state?.polls ?? [];
    expect(polls.length).toBeGreaterThanOrEqual(2);

    const [first, second] = polls;
    const crossed = await ultimate.voteChatPollAction({
      pollMessageId: first.messageId,
      optionIds: [second.options[0].id]
    });
    expect(crossed.ok).toBe(false);
  });
}, DB_TIMEOUT);
