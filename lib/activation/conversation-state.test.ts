import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/lib/content/strip-comments";
import { planActionsForMuddy, type MuddyActionContext } from "@/lib/activation/state";

/**
 * One message is not a relationship.
 *
 * "Has a conversation" used to mean "established", so the very first hello
 * promoted a Plan to primary -- the app answering somebody's opening message
 * by asking them to commit to meeting.
 */

const ctx = (over: Partial<MuddyActionContext> = {}): MuddyActionContext => ({
  hasSharedUpcomingPlan: false,
  hasExistingConversation: false,
  conversationState: "none",
  isNearby: false,
  waveAvailable: true,
  ...over
});

describe("A — nothing said yet", () => {
  it("offers Say hi", () => {
    expect(planActionsForMuddy(ctx()).primary).toBe("say_hi");
  });

  it("keeps a Plan second", () => {
    expect(planActionsForMuddy(ctx()).secondary).toBe("make_plan");
  });

  it("treats an empty thread as nothing said", () => {
    // The row existing is not evidence anybody spoke.
    const emptyRow = ctx({ hasExistingConversation: true, conversationState: "none" });
    expect(planActionsForMuddy(emptyRow).primary).toBe("say_hi");
  });
});

describe("B — talking has just begun", () => {
  const started = ctx({ hasExistingConversation: true, conversationState: "started" });

  it("suggests continuing the conversation", () => {
    /* THE FIX. After one hello, the natural next move is to keep talking --
     * not to be asked to commit to meeting. */
    expect(planActionsForMuddy(started).primary).toBe("message");
  });

  it("keeps a Plan available, but second", () => {
    expect(planActionsForMuddy(started).secondary).toBe("make_plan");
  });

  it("says why", () => {
    expect(planActionsForMuddy(started).reason).toBe("conversation_started");
  });

  it("does not promote a Plan on one message", () => {
    // The specific regression: under-promote Plans rather than push commitment.
    expect(planActionsForMuddy(started).primary).not.toBe("make_plan");
  });
});

describe("C — an established relationship", () => {
  const established = ctx({ hasExistingConversation: true, conversationState: "established" });

  it("finally suggests a Plan", () => {
    expect(planActionsForMuddy(established).primary).toBe("make_plan");
    expect(planActionsForMuddy(established).secondary).toBe("message");
    expect(planActionsForMuddy(established).reason).toBe("established");
  });
});

describe("the stronger signal is a reply, not a word count", () => {
  const projection = stripComments(readFileSync("lib/activation/projection.ts", "utf8"));

  it("derives established from two distinct senders", () => {
    /* Direction, not volume: somebody who sent three messages into silence is
     * still waiting, and suggesting a plan there would be worse, not better. */
    expect(projection).toContain("sendersByConversation");
    expect(projection).toContain('senders.size > 1 ? "established" : "started"');
  });

  it("reads who spoke from real messages", () => {
    expect(projection).toContain('.select("conversation_id, sender_id, created_at")');
  });

  it("invents no score or threshold", () => {
    const focus = projection.slice(
      projection.indexOf("async function loadRelationshipFocus"),
      projection.indexOf("export async function loadActivationProjection")
    );
    for (const banned of ["score", "weight", "Math.random", "> 3", ">= 5"]) {
      expect(focus).not.toContain(banned);
    }
  });
});

describe("the stronger rules still win", () => {
  it("a shared Plan overrides every conversation state", () => {
    for (const conversationState of ["none", "started", "established"] as const) {
      const plan = planActionsForMuddy(
        ctx({ hasSharedUpcomingPlan: true, hasExistingConversation: true, conversationState })
      );
      expect(plan.primary).toBe("view_plan");
      expect(plan.secondary).not.toBe("make_plan");
    }
  });

  it("nearby still offers a Wave once people have spoken", () => {
    const nearby = ctx({
      hasExistingConversation: true,
      conversationState: "started",
      isNearby: true
    });
    expect(planActionsForMuddy(nearby).primary).toBe("wave");
  });

  it("nearby falls back to Message on cooldown", () => {
    const blocked = ctx({
      hasExistingConversation: true,
      conversationState: "established",
      isNearby: true,
      waveAvailable: false
    });
    expect(planActionsForMuddy(blocked).primary).toBe("message");
    expect(planActionsForMuddy(blocked).reason).toBe("nearby_wave_blocked");
  });

  it("never waves at somebody nobody has spoken to", () => {
    const stranger = ctx({ isNearby: true, conversationState: "none" });
    expect(planActionsForMuddy(stranger).primary).toBe("say_hi");
  });
});

describe("the engine stays one deterministic function", () => {
  it("returns the same plan for the same input", () => {
    const input = ctx({ hasExistingConversation: true, conversationState: "started" });
    const first = planActionsForMuddy(input);
    for (let i = 0; i < 5; i += 1) expect(planActionsForMuddy(input)).toEqual(first);
  });

  it("has no second implementation", () => {
    const focus = stripComments(readFileSync("lib/activation/relationship-focus.ts", "utf8"));
    expect(focus).toContain("planActionsForMuddy");
    expect(focus).not.toContain('"make_plan"');
  });
});
