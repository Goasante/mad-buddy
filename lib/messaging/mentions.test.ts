import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/lib/content/strip-comments";
import {
  applyMentionSelection,
  filterMentionCandidates,
  findMentionTrigger,
  mentionUserIdsForSend,
  reconcileMentions,
  splitTextWithMentions,
  type MentionCandidate
} from "@/lib/messaging/mentions";

/**
 * A mention names a PERSON, not a piece of text.
 *
 * The whole design turns on that: a display name changes, repeats, and can be
 * shared by two people, so matching "@Ama" against names at send time would
 * let a rename silently redirect a mention. Identity is the user id, carried
 * structurally beside the text.
 */

const AMA: MentionCandidate = { userId: "u-ama", displayName: "Ama", username: "ama", avatarUrl: null };
const AMA_S: MentionCandidate = { userId: "u-ama2", displayName: "Ama Serwaa", username: "serwaa", avatarUrl: null };
const KWAME: MentionCandidate = { userId: "u-kwame", displayName: "Kwame", username: "kwame", avatarUrl: null };
const ALL = [AMA, AMA_S, KWAME];

describe("the @ trigger", () => {
  it("opens at the start of a message", () => {
    expect(findMentionTrigger("@", 1)).toEqual({ start: 0, end: 1, query: "" });
  });

  it("opens after a space", () => {
    expect(findMentionTrigger("hey @am", 7)?.query).toBe("am");
  });

  it("does NOT open mid-word, so an email address is safe", () => {
    expect(findMentionTrigger("mail@example.com", 16)).toBeNull();
  });

  it("closes once a space is typed after the query", () => {
    // "@ama " is a finished token; the picker has no business staying open.
    expect(findMentionTrigger("hey @ama ", 9)).toBeNull();
  });

  it("is lowercased for matching, so case never hides a member", () => {
    expect(findMentionTrigger("@AM", 3)?.query).toBe("am");
  });
});

describe("filtering candidates", () => {
  it("offers everyone on a bare @", () => {
    expect(filterMentionCandidates(ALL, "")).toHaveLength(3);
  });

  it("filters by display name as the user types", () => {
    expect(filterMentionCandidates(ALL, "kwa").map((c) => c.userId)).toEqual(["u-kwame"]);
  });

  it("ranks prefix matches above interior ones", () => {
    // "am" is a prefix of Ama and Ama Serwaa, and interior to Kwame.
    const ids = filterMentionCandidates(ALL, "am").map((c) => c.userId);
    expect(ids.slice(0, 2)).toEqual(["u-ama", "u-ama2"]);
    expect(ids).toContain("u-kwame");
  });

  it("matches usernames too", () => {
    expect(filterMentionCandidates(ALL, "serwaa").map((c) => c.userId)).toEqual(["u-ama2"]);
  });

  it("returns nothing when no member matches", () => {
    expect(filterMentionCandidates(ALL, "zzz")).toEqual([]);
  });
});

describe("selection keeps the identity", () => {
  it("inserts the readable name into the text", () => {
    const trigger = findMentionTrigger("hey @am", 7)!;
    expect(applyMentionSelection("hey @am", trigger, AMA).text).toBe("hey @Ama ");
  });

  it("puts the caret after the inserted name", () => {
    const trigger = findMentionTrigger("@am", 3)!;
    expect(applyMentionSelection("@am", trigger, AMA).caret).toBe("@Ama ".length);
  });

  it("preserves text after the caret", () => {
    const trigger = findMentionTrigger("@am are you coming", 3)!;
    expect(applyMentionSelection("@am are you coming", trigger, AMA).text).toBe("@Ama  are you coming");
  });
});

describe("editing the text reconciles the structured mentions", () => {
  const mentions = [{ userId: "u-ama", displayName: "Ama" }];

  it("keeps a mention whose name is still present", () => {
    expect(reconcileMentions("hey @Ama", mentions)).toHaveLength(1);
  });

  it("DROPS a mention whose name was deleted", () => {
    // Otherwise "Hey @Ama" edited down to "Hey" would still notify Ama.
    expect(reconcileMentions("hey", mentions)).toEqual([]);
  });

  it("deduplicates the same person mentioned twice", () => {
    const twice = [
      { userId: "u-ama", displayName: "Ama" },
      { userId: "u-ama", displayName: "Ama" }
    ];
    expect(reconcileMentions("@Ama and @Ama", twice)).toHaveLength(1);
  });

  it("never INVENTS a mention from text alone", () => {
    // Typing "@Ama" by hand, without choosing her, must not mention her --
    // that is the display-name matching this design exists to avoid.
    expect(reconcileMentions("hey @Ama", [])).toEqual([]);
  });
});

describe("what actually gets sent", () => {
  it("sends unique ids", () => {
    const ids = mentionUserIdsForSend(
      [
        { userId: "u-ama", displayName: "Ama" },
        { userId: "u-ama", displayName: "Ama" },
        { userId: "u-kwame", displayName: "Kwame" }
      ],
      "u-me"
    );
    expect(ids.sort()).toEqual(["u-ama", "u-kwame"]);
  });

  it("never sends the sender, so nobody notifies themselves", () => {
    const ids = mentionUserIdsForSend([{ userId: "u-me", displayName: "Me" }], "u-me");
    expect(ids).toEqual([]);
  });
});

describe("rendering", () => {
  it("leaves ordinary text untouched", () => {
    expect(splitTextWithMentions("no mentions here", [])).toEqual([
      { text: "no mentions here", mentionedUserId: null }
    ]);
  });

  it("emphasises only what the server stored", () => {
    const runs = splitTextWithMentions("hi @Ama", [{ userId: "u-ama", displayName: "Ama" }]);
    expect(runs).toEqual([
      { text: "hi ", mentionedUserId: null },
      { text: "@Ama", mentionedUserId: "u-ama" }
    ]);
  });

  it("does not highlight text that merely looks like a mention", () => {
    // No stored mention means no highlight, so the emphasis can never claim
    // more than what was persisted and notified.
    const runs = splitTextWithMentions("hi @Ama", []);
    expect(runs).toEqual([{ text: "hi @Ama", mentionedUserId: null }]);
  });

  it("prefers the longer name when two overlap", () => {
    const runs = splitTextWithMentions("hi @Ama Serwaa", [
      { userId: "u-ama", displayName: "Ama" },
      { userId: "u-ama2", displayName: "Ama Serwaa" }
    ]);
    expect(runs.find((run) => run.mentionedUserId)?.mentionedUserId).toBe("u-ama2");
  });

  it("handles several mentions in one sentence", () => {
    const runs = splitTextWithMentions("@Ama and @Kwame", [
      { userId: "u-ama", displayName: "Ama" },
      { userId: "u-kwame", displayName: "Kwame" }
    ]);
    expect(runs.filter((run) => run.mentionedUserId)).toHaveLength(2);
  });
});

describe("server-side authorization", () => {
  const mobile = stripComments(readFileSync("lib/messaging/mobile.ts", "utf8"));
  const persist = mobile.slice(mobile.indexOf("async function persistMentions"), mobile.indexOf("async function notifyOtherMembers"));

  it("re-checks every id against current joined membership", () => {
    // The client picker is convenience, never authorization. This one check
    // covers a forged id, a removed member, an invited-not-joined member, and
    // somebody from another Circle.
    expect(persist).toContain('.from("conversation_members")');
    expect(persist).toContain('.eq("status", "joined")');
    expect(persist).toContain('.eq("conversation_id", conversationId)');
  });

  it("stores only ids that survived that check", () => {
    expect(persist).toContain("const allowed = (eligible ?? []).map((row) => row.user_id)");
  });

  it("drops the sender before storing anything", () => {
    expect(persist).toContain("id !== senderId");
  });

  it("deduplicates through the primary key", () => {
    expect(persist).toContain('onConflict: "message_id,mentioned_user_id"');
  });

  it("runs only after the message exists, so a failed send leaves no rows", () => {
    const send = mobile.slice(mobile.indexOf("export async function sendMessage"), mobile.indexOf("async function persistMentions"));
    // The insert-failure branch returns before mentions are ever touched.
    expect(send.indexOf("Couldn't send that message.")).toBeLessThan(send.indexOf("persistMentions"));
  });
});

describe("notifications are not duplicated", () => {
  const mobile = stripComments(readFileSync("lib/messaging/mobile.ts", "utf8"));

  it("marks the existing notification rather than sending a second", () => {
    // Every joined member already gets exactly one notification per message;
    // a separate mention push would mean two buzzes for one sentence.
    expect(mobile).toContain("mentionedUserIds.includes(member.user_id)");
    expect(mobile).toContain("mentioned you");
  });

  it("addresses exactly the ids that were stored", () => {
    // One source of truth for "who was mentioned" -- the notification cannot
    // disagree with the database.
    expect(mobile).toContain("const mentionedUserIds = await persistMentions(");
  });

  it("uses the existing delivery pipeline", () => {
    expect(mobile).toContain("deliverNotification(admin, {");
  });
});

describe("editing reconciles in both directions", () => {
  const actions = stripComments(readFileSync("app/(app)/messaging-actions.ts", "utf8"));
  const edit = actions.slice(
    actions.indexOf("export async function editMessageAction"),
    actions.indexOf("export async function deleteMessageAction")
  );

  it("accepts the mentions the message names after the edit", () => {
    expect(edit).toContain("mentionUserIds: readonly string[] = []");
  });

  it("ADDS a newly chosen mention", () => {
    // Removal alone was not enough: adding "@Kwame" while editing has to
    // store him, or the highlight and the notification disagree with the text.
    expect(edit).toContain("await persistMentions(");
  });

  it("validates an added mention exactly as sending does", () => {
    // Reuses the send path's validator, so an edit cannot mention somebody a
    // send could not -- including a member who has left since.
    expect(edit).toContain("persistMentions(");
    expect(actions).toContain("persistMentions,");
  });

  it("REMOVES a mention the edit no longer names", () => {
    expect(edit).toContain('.from("message_mentions")');
    expect(edit).toContain(".delete()");
  });

  it("removes by difference, so untouched mentions keep their row", () => {
    expect(edit).toContain("!kept.includes(id)");
  });

  it("does not decide identity from the message text", () => {
    // No name matching anywhere in the edit path.
    expect(edit).not.toContain("full_name");
    expect(edit).not.toContain("nextText.includes");
  });
});

describe("a tombstoned message mentions nobody", () => {
  const mobile = stripComments(readFileSync("lib/messaging/mobile.ts", "utf8"));

  it("serves no mentions for a deleted message", () => {
    // Deleting nulls the text but keeps the row, so the mention rows survive
    // by design. A message that says nothing must not still name someone.
    expect(mobile).toContain("row.deleted_at ? [] : mentionsByMessage.get(row.id)");
  });

  it("still nulls the text, using the existing lifecycle", () => {
    expect(mobile).toContain("text: row.deleted_at ? null : row.text_content");
  });
});

describe("composer wiring", () => {
  const composer = stripComments(readFileSync("components/messaging/message-composer.tsx", "utf8"));
  const circle = stripComments(readFileSync("components/groups/group-detail-page.tsx", "utf8"));

  it("no longer says mentions are coming soon", () => {
    expect(composer).not.toContain("Mentions are coming to group chats soon.");
  });

  it("offers the picker only where candidates exist", () => {
    // A DM passes none, so the affordance never appears there.
    expect(composer).toContain("isGroup && mentionCandidates.length > 0");
  });

  it("sends ids, not names", () => {
    expect(composer).toContain("mentionUserIds: mentionUserIdsForSend(");
  });

  it("supports keyboard navigation and Escape", () => {
    expect(composer).toContain('event.key === "ArrowDown"');
    expect(composer).toContain('event.key === "ArrowUp"');
    expect(composer).toContain('event.key === "Escape"');
  });

  it("takes candidates from the Circle's own member list", () => {
    // Not a second membership query, and not a second authority.
    expect(circle).toContain("mentionCandidates={mentionCandidates}");
    expect(circle).toContain("orderedMembers");
  });

  it("includes the viewer, whose self-mention simply never notifies", () => {
    // "@Ama and I are driving" is ordinary phrasing; excluding yourself would
    // make the picker disagree with what people actually write. The server
    // drops the sender before storing, so it renders and never buzzes.
    const block = circle.slice(circle.indexOf("const mentionCandidates"), circle.indexOf("const ownershipOptions"));
    expect(block).not.toContain("!== group.viewerId");
  });
});
