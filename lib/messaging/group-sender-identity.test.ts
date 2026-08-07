import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RUN_GAP_MS, startsNewDay, startsNewRun } from "@/lib/messaging/conversation-presence";
import { stripComments } from "@/lib/content/strip-comments";

/**
 * Group sender identity (Stage 3A).
 *
 * A group message must say who sent it. The grouping rules are pure and tested
 * directly; the rendering and projection rules are asserted against source,
 * because the failures that matter here are "a private field reached the
 * client" and "we added an N+1", neither of which a render test would catch.
 */

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const projection = stripComments(read("lib/messaging/mobile.ts"));
const groupPage = stripComments(read("components/groups/group-detail-page.tsx"));

const AMA = "11111111-1111-4111-8111-111111111111";
const KOFI = "22222222-2222-4222-8222-222222222222";
const at = (iso: string) => iso;

// ---------------------------------------------------------------------------
// Grouping — the pure helper
// ---------------------------------------------------------------------------

describe("consecutive message grouping", () => {
  it("groups two consecutive messages from the same sender", () => {
    const first = { isMine: false, senderId: AMA, createdAt: at("2026-08-07T10:00:00.000Z") };
    const second = { isMine: false, senderId: AMA, createdAt: at("2026-08-07T10:01:00.000Z") };
    expect(startsNewRun(second, first)).toBe(false);
  });

  it("breaks the run when the sender changes", () => {
    // The group-specific case: both are "not mine", so isMine alone would
    // merge Ama and Kofi into one block under Ama's name.
    const ama = { isMine: false, senderId: AMA, createdAt: at("2026-08-07T10:00:00.000Z") };
    const kofi = { isMine: false, senderId: KOFI, createdAt: at("2026-08-07T10:00:30.000Z") };
    expect(startsNewRun(kofi, ama)).toBe(true);
  });

  it("breaks the run on a meaningful time gap", () => {
    const first = { isMine: false, senderId: AMA, createdAt: at("2026-08-07T10:00:00.000Z") };
    const later = {
      isMine: false,
      senderId: AMA,
      createdAt: new Date(Date.parse(first.createdAt) + RUN_GAP_MS + 1000).toISOString()
    };
    expect(startsNewRun(later, first)).toBe(true);
  });

  it("breaks the run at a date boundary even inside the gap window", () => {
    // Two messages a minute apart across midnight: a run must never straddle
    // the day divider drawn between its own messages.
    const before = { isMine: false, senderId: AMA, createdAt: "2026-08-07T23:59:30.000Z" };
    const after = { isMine: false, senderId: AMA, createdAt: "2026-08-08T00:00:10.000Z" };
    expect(startsNewDay(after.createdAt, before.createdAt)).toBe(true);
    expect(startsNewRun(after, before)).toBe(true);
  });

  it("breaks the run around a system message", () => {
    const system = { isMine: false, senderId: null, createdAt: "2026-08-07T10:00:10.000Z" };
    const human = { isMine: false, senderId: AMA, createdAt: "2026-08-07T10:00:20.000Z" };
    expect(startsNewRun(system, { isMine: false, senderId: AMA, createdAt: "2026-08-07T10:00:00.000Z" })).toBe(true);
    expect(startsNewRun(human, system)).toBe(true);
  });

  it("always starts a run at the top of the thread", () => {
    expect(startsNewRun({ isMine: false, senderId: AMA, createdAt: at("2026-08-07T10:00:00.000Z") }, undefined)).toBe(true);
  });

  it("still separates own messages from incoming ones", () => {
    const mine = { isMine: true, senderId: KOFI, createdAt: "2026-08-07T10:00:10.000Z" };
    const theirs = { isMine: false, senderId: AMA, createdAt: "2026-08-07T10:00:00.000Z" };
    expect(startsNewRun(mine, theirs)).toBe(true);
  });

  it("keeps direct-conversation behaviour when no senderId is supplied", () => {
    // The DM view calls this without senderId; adding the group rule must not
    // change what those callers already do.
    const first = { isMine: false, createdAt: "2026-08-07T10:00:00.000Z" };
    const second = { isMine: false, createdAt: "2026-08-07T10:01:00.000Z" };
    expect(startsNewRun(second, first)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The sender projection
// ---------------------------------------------------------------------------

describe("sender projection", () => {
  it("resolves senders in ONE batched query, not per message", () => {
    // The N+1 this exists to prevent: a 200-message thread must cost one
    // profile query, not two hundred.
    expect(projection).toContain('.in("user_id", senderIds)');
    expect(projection).toContain("[...new Set(rows.map((row) => row.sender_id)");
  });

  it("dedupes senders by user id", () => {
    expect(projection).toContain("const senderById = new Map<");
  });

  it("loads membership tiers in the same batched pass", () => {
    expect(projection).toContain("loadEffectivePlansForUsers(admin, senderIds)");
  });

  it("selects ONLY fields a co-member may already see", () => {
    // The column list itself, between select( and its closing paren — sliced
    // past `from("profiles")` so the table name's own bracket is not the one
    // that terminates the match.
    const anchor = 'admin.from("profiles").select(';
    const select = projection.slice(projection.indexOf(anchor) + anchor.length);
    const columns = select.slice(0, select.indexOf(")"));
    expect(columns).toContain("full_name");
    expect(columns).toContain("avatar_url");
    expect(columns).toContain("username");
    // Everything a message list must never carry.
    for (const forbidden of ["email", "phone", "latitude", "longitude", "date_of_birth"]) {
      expect(columns, `sender projection must not select ${forbidden}`).not.toContain(forbidden);
    }
  });
});

// ---------------------------------------------------------------------------
// Privacy
// ---------------------------------------------------------------------------

describe("unavailable senders", () => {
  it("has one fallback flag that never says why", () => {
    expect(projection).toContain("senderUnavailable");
  });

  it("does not distinguish deleted, blocked or moderated", () => {
    // Naming the reason is exactly the leak the rule forbids.
    const field = projection.slice(projection.indexOf("senderUnavailable:"));
    const expression = field.slice(0, field.indexOf("\n"));
    expect(expression.toLowerCase()).not.toContain("block");
    expect(expression.toLowerCase()).not.toContain("moderat");
    expect(expression.toLowerCase()).not.toContain("deleted");
  });

  it("renders an unavailable sender without a profile link", () => {
    // No route to a profile the viewer is no longer authorised to open.
    expect(groupPage).toContain("message.senderUnavailable || !message.senderUsername");
  });

  it("never renders the internal user id", () => {
    expect(groupPage).not.toContain("{message.senderId}");
  });
});

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

describe("group message presentation", () => {
  it("shows avatar, name and timestamp for incoming messages", () => {
    expect(groupPage).toContain("<UserAvatar");
    expect(groupPage).toContain("{message.senderName}");
    expect(groupPage).toContain("formatRelativeTime(message.createdAt)");
  });

  it("shows identity once per run, not per bubble", () => {
    expect(groupPage).toContain("const showIdentity = newRun && !message.isMine");
  });

  it("does not put an identity header on own messages", () => {
    // The trailing alignment and primary fill already say "you", exactly as
    // in a direct conversation.
    expect(groupPage).toContain("!message.isMine");
    expect(groupPage).not.toContain('"You"');
  });

  it("reuses the canonical premium badge and avatar ring", () => {
    expect(groupPage).toContain("<PremiumPlanBadge");
    expect(groupPage).toContain("membershipTier={publicMembershipTier(message.senderPlan)}");
  });

  it("opens the canonical profile route, not a group-specific modal", () => {
    expect(groupPage).toContain("href={`/friends/${message.senderUsername}`}");
  });

  it("keeps a 44px tap target around the avatar", () => {
    expect(groupPage).toContain("h-11 w-11");
  });

  it("reuses the shared grouping helper rather than a Groups copy", () => {
    expect(groupPage).toContain('from "@/lib/messaging/conversation-presence"');
  });
});

describe("accessibility", () => {
  it("announces author and time once per message", () => {
    expect(groupPage).toContain("`Message from ${message.senderName}`");
  });

  it("hides the decorative timestamp from screen readers", () => {
    // It is already inside the sr-only label above, so exposing it twice
    // would make the reader say the time on every bubble.
    expect(groupPage).toContain('aria-hidden="true"');
  });

  it("marks avatars decorative so the name is not read twice", () => {
    expect(groupPage).toContain("decorative");
  });
});
