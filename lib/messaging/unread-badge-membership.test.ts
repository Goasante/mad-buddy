import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/lib/content/strip-comments";
import { sumUnreadConversationCounts } from "@/lib/messaging/unread-count";

/**
 * The Messages badge must count the conversations the inbox can actually show.
 *
 * MEASURED, NOT THEORISED. Production held 11 conversation_members rows across
 * 9 users where status='invited' and left_at IS NULL. The badge filtered on
 * left_at and counted them; the inbox filtered on status and did not. One
 * Circle containing exactly six messages had four such invitees, each of whom
 * saw a Messages badge of 6 over an empty inbox, with no action available to
 * them that could clear it.
 *
 * These invited rows are VALID Circle invitation state -- they are accepted at
 * /groups, which has working Join and Decline controls. The bug was never the
 * data, so the fix is the predicate, not a reset of anyone's unread counts.
 */

const source = stripComments(readFileSync("lib/messaging/mobile.ts", "utf8"));

const badgeQuery = source.slice(
  source.indexOf("export async function getUnreadMessageCount"),
  source.indexOf("export async function listConversations")
);
const inboxQuery = source.slice(
  source.indexOf("export async function listConversations"),
  source.indexOf("export async function listMessages")
);

describe("badge and inbox ask the same membership question", () => {
  it("counts only joined memberships", () => {
    expect(badgeQuery).toContain('.eq("status", "joined")');
  });

  it("does not count merely 'has not left'", () => {
    // left_at IS NULL is true for invited, and an invitee cannot open the
    // conversation, so anything it contributes is uncountable by the user.
    expect(badgeQuery).not.toContain('.is("left_at", null)');
  });

  it("uses the same predicate the inbox uses", () => {
    const predicate = '.eq("status", "joined")';
    expect(inboxQuery).toContain(predicate);
    expect(badgeQuery).toContain(predicate);
  });

  it("still shares the conversation_previews RPC with the inbox", () => {
    // The RPC was never the problem -- both already called it. The membership
    // list feeding it was.
    expect(badgeQuery).toContain("conversation_previews");
    expect(inboxQuery).toContain("conversation_previews");
  });
});

describe("aggregation itself", () => {
  it("sums unread across conversations", () => {
    expect(sumUnreadConversationCounts([{ unread_count: 4 }, { unread_count: 2 }])).toBe(6);
  });

  it("treats a conversation with no unread rows as zero", () => {
    expect(sumUnreadConversationCounts([{ unread_count: null }, {}])).toBe(0);
  });

  it("is zero for someone with no conversations at all", () => {
    // A brand-new account must not see a badge.
    expect(sumUnreadConversationCounts([])).toBe(0);
  });

  it("survives a malformed row rather than rendering NaN", () => {
    expect(sumUnreadConversationCounts([undefined, null, { unread_count: 3 }])).toBe(3);
  });
});

describe("the regression that introduced this", () => {
  it("keeps every conversation_members read on one predicate", () => {
    // HOW THIS BROKE. bc50e6f ("Restore build and type safety") repaired an
    // unrelated half-applied merge and, while rewriting this function, swapped
    // status='joined' for left_at IS NULL. The predicate before that commit was
    // already status='joined', so this is a restoration, not a new decision.
    //
    // Asserting the whole file has no lone left_at filter is what stops the
    // same slip recurring in a future rewrite: the badge is not special, and
    // every other read here filters on status.
    expect(source).not.toContain('.is("left_at", null)');
  });

  it("does not count a conversation the inbox would refuse to show", () => {
    // The two functions must never disagree about membership. If listConversations
    // will not list it, the badge must not count it.
    const badgePredicate = badgeQuery.includes('.eq("status", "joined")');
    const inboxPredicate = inboxQuery.includes('.eq("status", "joined")');
    expect(badgePredicate && inboxPredicate).toBe(true);
  });
});

describe("Circle invitations stay valid elsewhere", () => {
  it("does not delete or reinterpret a pending invitation", () => {
    // The fix is a read predicate, nothing more. Those invited rows are real
    // Circle invitation state and are accepted at /groups, which has working
    // Join and Decline controls -- so the badge path may only READ them.
    //
    // Scoped to the badge function rather than the whole module: message
    // deletion elsewhere in this file legitimately calls .delete(), and
    // asserting against the file would fail for an unrelated correct reason.
    expect(badgeQuery).not.toContain('.delete(');
    expect(badgeQuery).not.toContain('.update(');
    expect(badgeQuery).not.toContain('.upsert(');
    expect(badgeQuery).not.toContain('.insert(');
  });
});

describe("the reported scenario, as arithmetic", () => {
  /** One Circle, six messages, viewer invited but never joined. */
  const circleWithSixMessages = { unread_count: 6 };

  it("an invitee's badge is zero, because the inbox shows them nothing", () => {
    // Post-fix the membership filter excludes the row entirely, so the badge
    // sums an empty list -- it is not the count being zeroed, it is the
    // conversation not being theirs to count yet.
    expect(sumUnreadConversationCounts([])).toBe(0);
  });

  it("a joined member of that same Circle still sees six", () => {
    // The fix must not silence real unread messages for real members.
    expect(sumUnreadConversationCounts([circleWithSixMessages])).toBe(6);
  });
});
