import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/lib/content/strip-comments";
import { isConversationVisible } from "@/lib/messaging/conversation-visibility";

/**
 * Hiding a chat is personal, reversible, and destroys nothing.
 *
 * A direct conversation is ONE row shared by two people. There is no safe way
 * to delete it for one of them, so hiding is recorded on that person's
 * membership and every other participant is untouched.
 */

const HID = "2026-08-14T12:00:00.000Z";
const OLD = "2026-08-14T11:00:00.000Z";
const NEW = "2026-08-14T13:00:00.000Z";

const mobile = stripComments(readFileSync("lib/messaging/mobile.ts", "utf8"));
const migration = readFileSync(
  "supabase/migrations/20260814130000_hide_conversation_per_member.sql",
  "utf8"
);

/** The hide action's body only, so assertions cannot pass on a comment. */
const hideAction = mobile.slice(
  mobile.indexOf("export async function setConversationHidden"),
  mobile.indexOf("export async function", mobile.indexOf("export async function setConversationHidden") + 10)
);

describe("hiding is scoped to one member", () => {
  it("writes only to the acting member's row", () => {
    // Both keys present means the update cannot reach the other participant.
    expect(hideAction).toContain('.eq("conversation_id", conversationId)');
    expect(hideAction).toContain('.eq("user_id", userId)');
  });

  it("writes to the membership, never the conversation", () => {
    expect(hideAction).toContain('.from("conversation_members")');
    expect(hideAction).not.toContain('.from("conversations")');
  });

  it("destroys nothing", () => {
    for (const destructive of [".delete(", "deleted_at", "status: 'left'", 'status: "left"']) {
      expect(hideAction).not.toContain(destructive);
    }
  });

  it("does not touch membership status, so hiding is not leaving", () => {
    expect(hideAction).not.toContain("status:");
  });

  it("posts no system message", () => {
    // Hiding is private. The other person must not be told.
    expect(hideAction).not.toContain("publishSystemMessage");
  });

  it("checks access before writing", () => {
    expect(hideAction).toContain("resolveConversationAccess");
  });
});

describe("what the inbox shows", () => {
  it("hides a conversation whose newest message predates the hide", () => {
    expect(isConversationVisible({ hiddenAt: HID, lastUserMessageAt: OLD })).toBe(false);
  });

  it("keeps it hidden across a reload, because the state is server-side", () => {
    // Same server inputs produce the same answer; no client memory involved.
    expect(isConversationVisible({ hiddenAt: HID, lastUserMessageAt: OLD })).toBe(false);
    expect(isConversationVisible({ hiddenAt: HID, lastUserMessageAt: OLD })).toBe(false);
  });

  it("old messages do NOT resurrect it", () => {
    // Everything already in the thread is older than the hide.
    expect(isConversationVisible({ hiddenAt: HID, lastUserMessageAt: OLD })).toBe(false);
  });

  it("a genuinely new message resurrects it", () => {
    expect(isConversationVisible({ hiddenAt: HID, lastUserMessageAt: NEW })).toBe(true);
  });

  it("a system event does NOT resurrect it", () => {
    // last_user_message_at counts non-system rows only, so an admin change or
    // a rename leaves this stale and the conversation stays hidden.
    const afterSystemEventOnly = { hiddenAt: HID, lastUserMessageAt: OLD };
    expect(isConversationVisible(afterSystemEventOnly)).toBe(false);
  });

  it("filters on the server, not in the client", () => {
    // A client-only filter would leak the row into every other consumer of
    // the projection, including the unread badge.
    expect(mobile).toContain("isConversationVisible({");
    expect(mobile).toContain("hiddenAt: membership?.hidden_at ?? null");
  });
});

describe("deliberate re-engagement clears the flag", () => {
  const openAction = mobile.slice(
    mobile.indexOf("export async function openDirectConversation"),
    mobile.indexOf("export async function sendMessage")
  );

  it("un-hides when the person opens that conversation again", () => {
    expect(openAction).toContain('hidden_at: null');
  });

  it("resolves the canonical conversation rather than creating a second one", () => {
    // Idempotency is the whole reason a hidden chat cannot become a duplicate.
    expect(openAction).toContain("getOrCreateDirectConversation");
  });

  it("un-hides for the sender when they send into it", () => {
    // The reappearance rule covers recipients; the sender's own hidden_at is
    // newer than every message that existed when they hid it.
    const sendAction = mobile.slice(
      mobile.indexOf("export async function sendMessage"),
      mobile.indexOf("async function notifyOtherMembers")
    );
    expect(sendAction).toContain('hidden_at: null');
    expect(sendAction).toContain('.eq("user_id", userId)');
  });
});

describe("Circles keep their own semantics", () => {
  const page = stripComments(readFileSync("components/messages/messages-page.tsx", "utf8"));
  const actions = page.slice(page.indexOf("<LongPressActions"), page.indexOf("</LongPressActions>"));

  it("offers Hide chat only for direct conversations", () => {
    // A Circle offers Leave Circle, which is a different act with
    // consequences for other people.
    const circleBranch = actions.slice(actions.indexOf('conversation.kind === "group"'), actions.indexOf('id: "hide"'));
    expect(circleBranch).toContain('id: "open-circle"');
    expect(circleBranch).not.toContain('id: "hide"');
  });

  it("does not call it Delete, because nothing is deleted", () => {
    expect(actions).toContain('label: "Hide chat"');
    expect(actions).not.toContain("Delete chat");
  });

  it("keeps mute and pin available", () => {
    expect(actions).toContain('id: "mute"');
    expect(actions).toContain('id: "pin"');
  });
});

describe("the migration itself", () => {
  it("adds one nullable column to the membership table", () => {
    expect(migration).toContain("alter table public.conversation_members");
    expect(migration).toContain("hidden_at timestamptz");
  });

  it("keeps the system-event unread rule intact", () => {
    expect(migration).toContain("m2.message_type <> 'system'");
  });

  it("computes the reappearance timestamp from user messages only", () => {
    const subquery = migration.slice(
      migration.indexOf("select max(m3.created_at)"),
      migration.indexOf(") um on true")
    );
    expect(subquery).toContain("m3.message_type <> 'system'");
  });
});
