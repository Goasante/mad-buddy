import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/lib/content/strip-comments";
import { conversationContext, startsNewRun } from "@/lib/messaging/conversation-presence";
import { eligibleQuickActions } from "@/lib/messaging/quick-action-eligibility";
import type { ConversationView } from "@/lib/messaging/mobile";

/**
 * A Plan Chat should feel like the Plan it belongs to.
 *
 * Every rule here is about IDENTITY and CONTEXT, never authorization: a title
 * is presentation, and membership is still the only thing that puts a
 * conversation in front of anyone.
 */

const mobile = stripComments(readFileSync("lib/messaging/mobile.ts", "utf8"));
const page = stripComments(readFileSync("components/messages/messages-page.tsx", "utf8"));

function conversation(overrides: Partial<ConversationView> = {}): ConversationView {
  return {
    id: "c1",
    title: "swim",
    avatarUrl: null,
    otherUsername: null,
    kind: "plan",
    lastMessagePreview: null,
    lastMessageAt: null,
    unreadCount: 0,
    muted: false,
    pinned: false,
    contextBadge: "Plan",
    planId: "p1",
    planCategory: null,
    planStartAt: null,
    otherPlan: null,
    otherTrustedSince: null,
    otherIsVerifiedAccount: false,
    planPhase: "upcoming",
    ...overrides
  };
}

describe("a Plan Chat is named after its Plan", () => {
  it("uses the Plan title, not the conversation type", () => {
    const branch = mobile.slice(
      mobile.indexOf('} else if (conversation.conversation_type === "plan")'),
      mobile.indexOf('title = groupNameByConversation.get(conversation.id) ?? "Group"')
    );
    expect(branch).toContain("planIdentityByPlanId.get(planId)?.title");
  });

  it("keeps 'Plan chat' only as a fallback when the Plan is unreadable", () => {
    const branch = mobile.slice(
      mobile.indexOf('} else if (conversation.conversation_type === "plan")'),
      mobile.indexOf('title = groupNameByConversation.get(conversation.id) ?? "Group"')
    );
    // The fallback must come AFTER the real title, never instead of it.
    expect(branch.indexOf("planIdentityByPlanId")).toBeLessThan(branch.indexOf('"Plan chat"'));
  });

  it("reads the title from plans, so a renamed Plan renames its chat", () => {
    expect(mobile).toContain('admin.from("plans").select("id, title, category, status, start_at, end_at")');
  });

  it("leaves direct and Circle naming alone", () => {
    expect(mobile).toContain('title = profile?.full_name?.trim() || "A Muddy"');
    expect(mobile).toContain('title = groupNameByConversation.get(conversation.id) ?? "Group"');
  });
});

describe("the context line says which Plan and when", () => {
  it("names the type and the date", () => {
    const at = new Date(Date.UTC(2026, 7, 18, 12, 38)).toISOString();
    const subtitle = conversationContext(conversation({ planStartAt: at, planPhase: "upcoming" })).subtitle;
    expect(subtitle).toMatch(/^Plan · /);
    expect(subtitle).not.toBe("From a shared plan");
  });

  it("never advertises a date for a Plan that is over", () => {
    const at = new Date(Date.UTC(2026, 7, 18, 12, 38)).toISOString();
    // planPhase folds cancelled/completed/expired into "past".
    expect(conversationContext(conversation({ planStartAt: at, planPhase: "past" })).subtitle).toBe(
      "Plan · Finished"
    );
  });

  it("says so plainly when the Plan has no date", () => {
    expect(conversationContext(conversation({ planStartAt: null, planPhase: "unscheduled" })).subtitle).toBe(
      "Plan · No date yet"
    );
  });

  it("leaves Events and Safe Arrival untouched", () => {
    expect(conversationContext(conversation({ contextBadge: "Event" })).subtitle).toBe("From an event");
    expect(conversationContext(conversation({ contextBadge: "Safe Arrival" })).subtitle).toBe(
      "Safe Arrival check-in"
    );
  });
});

describe("a message chip never impersonates an RSVP", () => {
  const ids = ["on_my_way", "im_here", "running_late", "where_to_meet", "cant_make_it", "start_without_me"];

  /* A Plan carries a canonical attendance answer, and this chip only sends a
   * sentence. Whatever the viewer's RSVP is, "I can't make it" states the
   * opposite of it -- so a Plan Chat does not offer attendance language at
   * all, in any phase. Declining belongs to the Plan's RSVP controls. */
  it("never offers attendance language in a Plan Chat, whatever the phase", () => {
    for (const phase of ["upcoming", "near_start", "active", "undated"] as const) {
      const actions = eligibleQuickActions({ context: "plan", phase, actionIds: ids });
      expect(actions, `phase=${phase} must not offer a decline`).not.toContain("cant_make_it");
    }
  });

  it("still offers real coordination in a Plan Chat", () => {
    const actions = eligibleQuickActions({ context: "plan", phase: "upcoming", actionIds: ids });
    expect(actions).toContain("where_to_meet");
    expect(eligibleQuickActions({ context: "plan", phase: "active", actionIds: ids })).toContain("im_here");
  });

  it("keeps it for contexts that have no RSVP to contradict", () => {
    // An Event, an Event Circle and a Safe Arrival thread carry no attendance
    // record, so there saying you cannot make it IS just a message.
    for (const context of ["event", "event_circle", "safe_arrival"] as const) {
      const actions = eligibleQuickActions({ context, phase: "upcoming", actionIds: ids });
      expect(actions, `${context} keeps its decline`).toContain("cant_make_it");
    }
  });

  it("leaves a plain direct message with no coordination chips at all", () => {
    expect(eligibleQuickActions({ context: "none", phase: "upcoming", actionIds: ids })).toEqual([]);
  });

  it("changes no RSVP itself — the chip only sends a message", () => {
    // The eligibility module must stay a pure presentation filter.
    const source = stripComments(readFileSync("lib/messaging/quick-action-eligibility.ts", "utf8"));
    expect(source).not.toContain("set_plan_participant_rsvp");
    expect(source).not.toContain("rsvpAction");
    expect(source).not.toContain("supabase");
  });
});

describe("multiple speakers are identified", () => {
  /* CONVERSATION IDENTITY, NOT MESSAGE HISTORY.
   *
   * A Plan with four members where only one person has spoken so far is still
   * a room with four people in it. Deriving "does this need a name?" from the
   * senders present in the loaded messages would hide that first speaker's
   * identity until somebody else replied -- and would flip the answer as
   * history paged in. The conversation KIND is the stable fact. */
  it("keys sender identity off the conversation kind, not who has spoken", () => {
    const decl = page.slice(page.indexOf("const hasMultipleSpeakers"));
    expect(decl.slice(0, 120)).toContain('selected.kind !== "direct"');
  });

  it("never counts distinct senders in the loaded messages", () => {
    const decl = page.slice(page.indexOf("const hasMultipleSpeakers"), page.indexOf("const dismissConversation"));
    for (const banned of ["senderId", "new Set", "distinct", "messages."]) {
      expect(decl, `sender-identity mode must not be derived from ${banned}`).not.toContain(banned);
    }
  });

  it("shows the sender's name and avatar on an incoming group message", () => {
    /* Asserts the GUARD, not merely that the identifier exists somewhere: an
     * earlier version of this test checked only the declaration and the JSX
     * body, so replacing the `hasMultipleSpeakers &&` condition with `false &&`
     * silently disabled the whole feature while every assertion still passed. */
    const rawPage = readFileSync("components/messages/messages-page.tsx", "utf8");
    expect(rawPage).toMatch(/!message\.isMine\s*&&\s*hasMultipleSpeakers\s*&&\s*startsNewRun\(/);
    /* Scoped to the label element itself, not a wide window: an earlier
     * version of this test sliced 500 characters and kept passing on the voice
     * bubble's own senderName prop further down, so deleting the label proved
     * nothing. This matches the rendered text node. */
    const block = page.slice(page.indexOf("!message.isMine &&"));
    expect(block.slice(0, 500)).toContain("<UserAvatar");
    // Read from the RAW file: stripComments reflows whitespace, which would
    // let a multi-line JSX label slip past a whitespace-sensitive match.
    const raw = readFileSync("components/messages/messages-page.tsx", "utf8");
    const label = raw.slice(raw.indexOf('<span className="text-xs font-medium text-muted-foreground">'));
    expect(label.slice(0, 160)).toContain("{message.senderName}");
  });

  it("uses the identity avatar, never the proximity one", () => {
    const block = page.slice(page.indexOf("!message.isMine &&"));
    expect(block.slice(0, 500)).not.toContain("GlowAvatar");
  });

  it("does not label your own messages with your own name", () => {
    const block = page.slice(page.indexOf("!message.isMine &&"));
    expect(block.slice(0, 120)).toContain("!message.isMine");
  });

  it("labels once per run, not once per message", () => {
    const block = page.slice(page.indexOf("!message.isMine &&"));
    expect(block.slice(0, 200)).toContain("startsNewRun(message, messages[messageIndex - 1])");
  });

  it("leaves a direct message with no sender labels", () => {
    // Two people, one of whom is you: "not mine" already identifies the other,
    // so a name above every incoming bubble would be noise.
    const decl = page.slice(page.indexOf("const hasMultipleSpeakers"));
    expect(decl.slice(0, 120)).toContain('!== "direct"');
  });

  it("groups consecutive messages from one sender and breaks on a new one", () => {
    const a = { isMine: false, senderId: "u1", createdAt: "2026-08-18T12:00:00.000Z" };
    const a2 = { isMine: false, senderId: "u1", createdAt: "2026-08-18T12:00:30.000Z" };
    const b = { isMine: false, senderId: "u2", createdAt: "2026-08-18T12:01:00.000Z" };
    expect(startsNewRun(a2, a)).toBe(false);
    expect(startsNewRun(b, a2)).toBe(true);
  });
});

describe("Plan context carries no proximity", () => {
  it("keeps Glow and distance out of the Plan Chat projection", () => {
    const block = mobile.slice(mobile.indexOf("const planIdentityByPlanId"));
    for (const forbidden of ["latitude", "longitude", "geohash", "proximity", "glow", "distance"]) {
      expect(block.slice(0, 1500).toLowerCase()).not.toContain(forbidden);
    }
  });

  it("selects no place text for the inbox", () => {
    const select = mobile.slice(mobile.indexOf('admin.from("plans").select('));
    expect(select.slice(0, 160)).not.toContain("custom_place_text");
  });
});
