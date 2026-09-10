from pathlib import Path


def replace_once(path: str, old: str, new: str, label: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match in {path}, found {count}")
    file.write_text(text.replace(old, new, 1))


# The new history action is a pure authorised read. The exhaustive auth contract
# intentionally requires every new messaging action to be classified.
auth_test = "lib/messaging/action-auth.test.ts"
replace_once(
    auth_test,
    '  "messaging-actions::getMessagesAction",\n  "messaging-actions::getPreparedVoicePlaybackAction",\n',
    '  "messaging-actions::getMessagesAction",\n  "messaging-actions::getOlderMessagesAction",\n  "messaging-actions::getPreparedVoicePlaybackAction",\n',
    "classify older-message action",
)

# The mention invariant is semantic, not a requirement to serialize mention
# persistence before the independent conversation metadata writes.
mentions_test = "lib/messaging/mentions.test.ts"
replace_once(
    mentions_test,
    '''  it("addresses exactly the ids that were stored", () => {\n    // One source of truth for "who was mentioned" -- the notification cannot\n    // disagree with the database.\n    expect(mobile).toContain("const mentionedUserIds = await persistMentions(");\n  });\n''',
    '''  it("addresses exactly the ids that were stored", () => {\n    // One source of truth for "who was mentioned" -- even though mention\n    // persistence now runs in parallel with independent metadata writes, the\n    // exact returned ids are still the ones passed into notification fan-out.\n    const send = mobile.slice(\n      mobile.indexOf("export async function sendMessage"),\n      mobile.indexOf("async function recordFirstDirectMessageMilestone")\n    );\n    expect(send).toMatch(/const\\s+\\[mentionedUserIds\\]\\s*=\\s*await\\s+Promise\\.all\\(\\[\\s*persistMentions\\(/);\n    expect(send).toContain("mentionedUserIds\\n      )");\n  });\n''',
    "parallel mention invariant",
)

# Promise.allSettled must not turn post-response failures into silence. The
# milestone helper already logs its own failure; notification rejection is
# logged here without message content, recipient ids, or conversation ids.
mobile = "lib/messaging/mobile.ts"
replace_once(
    mobile,
    '''  await scheduleAfterMessageAcknowledgement(async () => {\n    await Promise.allSettled([\n      notifyOtherMembers(\n        admin,\n        parsed.data.conversationId,\n        userId,\n        messagePreviewText(messageType, parsed.data.text) ?? "",\n        mentionedUserIds\n      ),\n      recordFirstDirectMessageMilestone(admin, userId, parsed.data.conversationId)\n    ]);\n  });\n''',
    '''  await scheduleAfterMessageAcknowledgement(async () => {\n    const [notificationResult, milestoneResult] = await Promise.allSettled([\n      notifyOtherMembers(\n        admin,\n        parsed.data.conversationId,\n        userId,\n        messagePreviewText(messageType, parsed.data.text) ?? "",\n        mentionedUserIds\n      ),\n      recordFirstDirectMessageMilestone(admin, userId, parsed.data.conversationId)\n    ]);\n    if (notificationResult.status === "rejected") {\n      console.warn("[messaging] post-send notification failed", {\n        reason: notificationResult.reason instanceof Error\n          ? notificationResult.reason.message\n          : String(notificationResult.reason)\n      });\n    }\n    if (milestoneResult.status === "rejected") {\n      // Defensive: the milestone helper currently catches/logs its own errors.\n      console.warn("[messaging] post-send activation task failed", {\n        reason: milestoneResult.reason instanceof Error\n          ? milestoneResult.reason.message\n          : String(milestoneResult.reason)\n      });\n    }\n  });\n''',
    "observable post-response failures",
)

# Add explicit race and lifecycle regression coverage. These are source/pure
# state contracts so they run without credentials and cover both event orders.
race_test = Path("lib/messaging/messaging-race-closeout.test.ts")
race_test.write_text(r'''import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  discardOptimistic,
  markAwaitingConfirmation,
  markRetrying,
  mergeForDisplay,
  pruneConfirmed,
  type OptimisticMessage
} from "@/lib/messaging/optimistic-messages";
import { mergeThreadMessage } from "@/lib/messaging/thread-cache";
import type { ChatMessageView } from "@/lib/messaging/mobile";

function optimistic(id: string, status: OptimisticMessage["status"] = "pending"): OptimisticMessage {
  return {
    clientMessageId: id,
    text: "hello",
    kind: "text",
    durationSeconds: null,
    createdAt: "2026-09-10T20:00:00.000Z",
    status
  };
}

function canonical(id: string, clientMessageId: string): ChatMessageView {
  return {
    id,
    senderId: "11111111-1111-4111-8111-111111111111",
    senderName: "You",
    senderAvatarUrl: null,
    senderUsername: null,
    senderPlan: null,
    senderTrustedSince: null,
    senderIsVerifiedAccount: false,
    senderUnavailable: false,
    mentions: [],
    senderRole: null,
    attachment: null,
    voice: null,
    isMine: true,
    clientMessageId,
    messageType: "text",
    text: "hello",
    quickActionType: null,
    createdAt: "2026-09-10T20:00:00.100Z",
    editedAt: null,
    deleted: false,
    state: "sent",
    myReaction: null
  };
}

describe("optimistic acknowledgement races converge to one message", () => {
  it("Realtime first, action acknowledgement second", () => {
    let pending = [optimistic("client-1")];
    let rows: ChatMessageView[] = [];

    rows = mergeThreadMessage(rows, canonical("server-1", "client-1"));
    pending = pruneConfirmed(pending, rows);
    // A later HTTP acknowledgement cannot recreate a row already reconciled.
    pending = markRetrying(pending, "client-1");

    expect(rows).toHaveLength(1);
    expect(pending).toHaveLength(0);
    expect(mergeForDisplay(rows, pending)).toHaveLength(1);
  });

  it("action acknowledgement first, Realtime second", () => {
    let pending = markRetrying([optimistic("client-2")], "client-2");
    let rows: ChatMessageView[] = [];

    rows = mergeThreadMessage(rows, canonical("server-2", "client-2"));
    pending = pruneConfirmed(pending, rows);

    expect(rows).toHaveLength(1);
    expect(pending).toHaveLength(0);
    expect(mergeForDisplay(rows, pending)).toHaveLength(1);
  });

  it("a repeated Realtime delivery replaces by canonical id instead of appending", () => {
    const row = canonical("server-3", "client-3");
    const once = mergeThreadMessage([], row);
    const twice = mergeThreadMessage(once, { ...row, state: "read" });
    expect(twice).toHaveLength(1);
    expect(twice[0].state).toBe("read");
  });

  it("a timeout keeps the same idempotency key for retry and later confirmation", () => {
    const timedOut = markAwaitingConfirmation([optimistic("client-4")], "client-4");
    expect(timedOut[0]).toMatchObject({ status: "pending", confirmationState: "unknown", clientMessageId: "client-4" });
    const retrying = markRetrying(timedOut, "client-4");
    expect(retrying[0].clientMessageId).toBe("client-4");
    const settled = discardOptimistic(retrying, "client-4");
    expect(settled).toHaveLength(0);
  });
});

describe("V4 timeout and Realtime lifecycle contracts", () => {
  const page = readFileSync("components/messages/messages-page-v4.tsx", "utf8");
  const composer = readFileSync("components/messaging/message-composer-v3.tsx", "utf8");
  const resilience = readFileSync("lib/network/resilience.ts", "utf8");

  it("keeps the 15s timer local to the send promise and treats timeout as ambiguous", () => {
    expect(resilience).toContain("DEFAULT_REQUEST_TIMEOUT_MS = 15_000");
    expect(composer).toContain('{ operation: "send message" }');
    expect(composer).toContain('onOptimisticSettled?.(send.clientMessageId, "pending")');
  });

  it("has one idempotent confirmation timer per client message and clears all on unmount", () => {
    expect(page).toContain("confirmationTimersRef.current.has(key)");
    expect(page).toContain("confirmationTimersRef.current.set(key, timer)");
    expect(page).toContain("for (const timer of timers.values()) clearTimeout(timer)");
    expect(page).toContain("timers.clear()");
  });

  it("a successful action also schedules single-message reconciliation, never a full-thread send refetch", () => {
    expect(page).toContain('outcome === "pending" || outcome === "sent"');
    expect(page).toContain("getMessageByClientMessageIdAction(conversationId, clientMessageId)");
    expect(page).toContain('onSent={() => { void syncConversations(); scrollToBottom(); }}');
  });

  it("owns one selected-conversation channel and removes it on cleanup", () => {
    expect(page).toContain(".channel(`chats-v4:${selectedId}`)");
    expect(page).toContain("if (!disposed) channel.subscribe()");
    expect(page).toContain("void supabase.removeChannel(channel)");
    expect(page).toContain("disposed = true");
  });
});
''')

# Add pagination contract coverage for tie timestamps and overlapping requests.
pagination_test = Path("lib/messaging/messaging-pagination-closeout.test.ts")
pagination_test.write_text(r'''import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const mobile = readFileSync("lib/messaging/mobile.ts", "utf8");
const actions = readFileSync("app/(app)/messaging-actions.ts", "utf8");
const page = readFileSync("components/messages/messages-page-v4.tsx", "utf8");

describe("message history pagination closeout", () => {
  it("uses created_at plus id as a stable keyset cursor", () => {
    expect(mobile).toContain('.order("created_at", { ascending: false })');
    expect(mobile).toContain('.order("id", { ascending: false })');
    expect(mobile).toContain("created_at.lt.${options.before.createdAt}");
    expect(mobile).toContain("id.lt.${options.before.id}");
  });

  it("overfetches one row to determine the final historical page", () => {
    expect(actions).toContain("limit: OLDER_MESSAGE_PAGE_SIZE + 1");
    expect(actions).toContain("const hasMore = rows.length > OLDER_MESSAGE_PAGE_SIZE");
    expect(actions).toContain("messages: hasMore ? rows.slice(1) : rows");
  });

  it("prevents overlapping upward page requests", () => {
    expect(page).toContain("loadingOlderMessages || !hasOlderMessages");
    expect(page).toContain("setLoadingOlderMessages(true)");
    expect(page).toContain("setLoadingOlderMessages(false)");
  });

  it("deduplicates an older page against messages that arrived while it was loading", () => {
    expect(page).toContain("const known = new Set(current.map((message) => message.id))");
    expect(page).toContain("page.messages.filter((message) => !known.has(message.id))");
  });

  it("preserves the reader's scroll anchor as history is prepended", () => {
    expect(page).toContain("const previousHeight = node?.scrollHeight ?? 0");
    expect(page).toContain("const previousTop = node?.scrollTop ?? 0");
    expect(page).toContain("node.scrollTop = previousTop + (node.scrollHeight - previousHeight)");
  });
});
''')
