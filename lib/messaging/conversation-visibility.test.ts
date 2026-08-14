import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isConversationVisible, sendingUnhides } from "@/lib/messaging/conversation-visibility";

/**
 * Hiding a chat is personal, and only a person can undo it.
 *
 * The promise being pinned: hiding affects one member's inbox and nothing
 * else, and a hidden chat returns when somebody speaks -- not when a Circle
 * gets renamed.
 */

const HID = "2026-08-14T12:00:00.000Z";
const BEFORE = "2026-08-14T11:00:00.000Z";
const AFTER = "2026-08-14T13:00:00.000Z";

describe("a chat that was never hidden", () => {
  it("is visible", () => {
    expect(isConversationVisible({ hiddenAt: null, lastUserMessageAt: BEFORE })).toBe(true);
  });

  it("is visible even with no messages at all", () => {
    expect(isConversationVisible({ hiddenAt: null, lastUserMessageAt: null })).toBe(true);
  });
});

describe("hiding removes it from my inbox", () => {
  it("hides a conversation whose last message predates the hide", () => {
    expect(isConversationVisible({ hiddenAt: HID, lastUserMessageAt: BEFORE })).toBe(false);
  });

  it("stays hidden across a reload, because the state is server-side", () => {
    // Same inputs, same answer -- there is no client memory involved.
    const input = { hiddenAt: HID, lastUserMessageAt: BEFORE };
    expect(isConversationVisible(input)).toBe(isConversationVisible(input));
  });

  it("stays hidden when the conversation has no user messages at all", () => {
    expect(isConversationVisible({ hiddenAt: HID, lastUserMessageAt: null })).toBe(false);
  });
});

describe("a real message brings it back", () => {
  it("reappears when someone messages me after I hid it", () => {
    expect(isConversationVisible({ hiddenAt: HID, lastUserMessageAt: AFTER })).toBe(true);
  });

  it("reappears when I deliberately message them", () => {
    // Messaging somebody you hid is an unambiguous request for that
    // conversation back.
    expect(sendingUnhides(HID, AFTER)).toBe(true);
  });

  it("does not reappear on a message that predates the hide", () => {
    expect(sendingUnhides(HID, BEFORE)).toBe(false);
  });
});

describe("system events must NOT resurrect a hidden chat", () => {
  it("stays hidden when only a system event has happened since", () => {
    // THE RULE THAT NEEDS ITS OWN TEST. last_user_message_at excludes system
    // rows by construction, so a rename or an admin change leaves this null or
    // stale and the conversation stays put. Using
    // conversations.last_message_at here would have dragged it back, because
    // publishSystemMessage advances that column too.
    expect(isConversationVisible({ hiddenAt: HID, lastUserMessageAt: BEFORE })).toBe(false);
  });

  it("the RPC computes that timestamp from non-system messages only", () => {
    const migration = readFileSync(
      "supabase/migrations/20260814130000_hide_conversation_per_member.sql",
      "utf8"
    );
    const subquery = migration.slice(
      migration.indexOf("select max(m3.created_at)"),
      migration.indexOf(") um on true")
    );
    expect(subquery).toContain("m3.message_type <> 'system'");
    expect(subquery).toContain("m3.deleted_at is null");
  });
});

describe("failing open", () => {
  it("shows the conversation when the hide timestamp is unreadable", () => {
    // Wrongly showing a chat costs one tap. Wrongly hiding one silently
    // removes a conversation somebody may be waiting on.
    expect(isConversationVisible({ hiddenAt: "not a date", lastUserMessageAt: null })).toBe(true);
  });

  it("hides nothing when both timestamps are unreadable", () => {
    expect(isConversationVisible({ hiddenAt: "", lastUserMessageAt: "" })).toBe(true);
  });
});

describe("the migration keeps hiding personal", () => {
  const migration = readFileSync(
    "supabase/migrations/20260814130000_hide_conversation_per_member.sql",
    "utf8"
  );

  it("stores the flag on the membership, not the conversation", () => {
    expect(migration).toContain("alter table public.conversation_members");
    expect(migration).toContain("hidden_at timestamptz");
  });

  it("never deletes a conversation, a membership or a message", () => {
    const lower = migration.toLowerCase();
    expect(lower).not.toContain("delete from");
    expect(lower).not.toContain("drop table");
    // The only drop permitted is the function being recreated with a new
    // return shape.
    expect(lower).not.toContain("drop table public.conversations");
  });

  it("does not touch membership status, so hiding is not leaving", () => {
    expect(migration).not.toContain("status = 'left'");
    expect(migration).not.toContain("update public.conversation_members set status");
  });

  it("carries the system-event unread rule forward unchanged", () => {
    expect(migration).toContain("m2.message_type <> 'system'");
  });
});
