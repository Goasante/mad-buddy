import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/lib/content/strip-comments";
import { selectRelationshipFocus, type FocusCandidate } from "@/lib/activation/relationship-focus";

/**
 * A row is not a conversation.
 *
 * Tapping "Say hi" creates the conversation before anybody has said anything.
 * Treating that row as evidence flipped the button to "Message" for a thread
 * still completely empty -- the app claiming a conversation had happened
 * because it had opened a door.
 */

const NOW = Date.UTC(2026, 7, 16, 20, 0, 0);
const projection = stripComments(readFileSync("lib/activation/projection.ts", "utf8"));

const muddy = (over: Partial<FocusCandidate> = {}): FocusCandidate => ({
  id: "a",
  displayName: "goasante",
  avatarUrl: null,
  connectedAtMs: NOW - 60 * 60 * 1000,
  hasSharedUpcomingPlan: false,
  conversationState: "none",
  lastConversationActivityMs: null,
  waveAvailable: true,
  ...over
});

describe("Say hi survives an empty conversation", () => {
  it("offers Say hi when no conversation exists", () => {
    expect(selectRelationshipFocus([muddy()])?.plan.primary).toBe("say_hi");
  });

  it("still offers Say hi after the row is created but nothing is said", () => {
    /* THE BUG. Say hi created the thread, the routing fix let it open, and
     * returning Home then said "Message" about a conversation with no
     * messages in it. */
    const emptyThread = muddy({ conversationState: "none", lastConversationActivityMs: null });
    expect(selectRelationshipFocus([emptyThread])?.plan.primary).toBe("say_hi");
  });

  it("switches to a conversation-aware action once somebody has spoken", () => {
    const spoken = muddy({
      conversationState: "established",
      lastConversationActivityMs: NOW - 5 * 60 * 1000
    });
    expect(selectRelationshipFocus([spoken])?.plan.primary).not.toBe("say_hi");
    expect(selectRelationshipFocus([spoken])?.plan.reason).toBe("established");
  });
});

describe("the projection counts messages, not rows", () => {
  it("derives conversation activity from real messages", () => {
    expect(projection).toContain('.from("messages")');
    expect(projection).toContain("newestUserMessageAt");
  });

  it("excludes system events from the evidence", () => {
    /* conversations.last_message_at will not do: system events advance it
     * too, which is why last_user_message_at exists elsewhere in messaging. */
    expect(projection).toContain('.neq("message_type", "system")');
  });

  it("ignores deleted messages", () => {
    expect(projection).toContain('.is("deleted_at", null)');
  });

  it("does not treat the conversation row as evidence", () => {
    /* MUTATION TARGET. `hasExistingConversation: conversation !== undefined`
     * over a map keyed by row existence is exactly the defect; the map must
     * only contain threads somebody has actually spoken in. */
    const focus = projection.slice(
      projection.indexOf("async function loadRelationshipFocus"),
      projection.indexOf("export async function loadActivationProjection")
    );
    expect(focus).toContain("if (activityMs === undefined) continue;");
  });

  it("skips the message query when there are no threads", () => {
    expect(projection).toContain("conversationIds.length");
  });
});

describe("first value is a separate question", () => {
  it("records no milestone from the activation projection", () => {
    /* Say hi's LABEL and the first_message_sent MILESTONE are related but not
     * the same concept, and this task must not merge them. */
    expect(projection).not.toContain("first_message_sent");
    expect(projection).not.toContain("recordMilestone");
  });

  it("keeps the milestone at the canonical send boundary", () => {
    const messaging = stripComments(readFileSync("lib/messaging/mobile.ts", "utf8"));
    expect(messaging).toContain("recordFirstDirectMessageMilestone(admin, userId, parsed.data.conversationId)");
    const open = messaging.slice(
      messaging.indexOf("export async function openDirectConversation"),
      messaging.indexOf("export async function sendMessage")
    );
    expect(open).not.toMatch(/recordMilestone|Milestone\s*\(|first_message_sent/);
  });
});

describe("the other rules are untouched", () => {
  it("still prefers a shared upcoming Plan", () => {
    const planned = muddy({ hasSharedUpcomingPlan: true, conversationState: "established" });
    expect(selectRelationshipFocus([planned])?.plan.primary).toBe("view_plan");
  });

  it("still refuses to offer a Wave off the nearby card", () => {
    const spoken = muddy({
      conversationState: "established",
      lastConversationActivityMs: NOW - 5 * 60 * 1000
    });
    const plan = selectRelationshipFocus([spoken])?.plan;
    expect(plan?.primary).not.toBe("wave");
    expect(plan?.secondary).not.toBe("wave");
  });

  it("reuses one direct conversation rather than creating another", () => {
    // Repeated Say hi resolves the same row by direct_key.
    const service = readFileSync("lib/messaging/service.ts", "utf8");
    expect(service).toContain("directConversationKey(senderId, recipientId)");
    expect(service).toContain('.eq("direct_key", key)');
  });
});
