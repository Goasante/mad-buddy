import { describe, expect, it } from "vitest";
import { planActionsForMuddy, type MuddyActionContext } from "@/lib/activation/state";

/**
 * What to offer about one Muddy, and why.
 *
 * The rules are a small table, not a recommender: same inputs, same answer,
 * every time. And the app never offers something the server would predictably
 * refuse -- a dead button is worse than a plainer one that works.
 */

const ctx = (over: Partial<MuddyActionContext> = {}): MuddyActionContext => ({
  hasSharedUpcomingPlan: false,
  hasExistingConversation: false,
  /* Pairs with hasExistingConversation: false. A thread nobody has spoken in
     is still "none" -- the row existing is not evidence anybody said
     anything. Cases meaning something else set it explicitly. */
  conversationState: "none",
  isNearby: false,
  waveAvailable: true,
  ...over
});

describe("CASE D — something is already arranged", () => {
  const plan = planActionsForMuddy(ctx({ hasSharedUpcomingPlan: true, isNearby: true }));

  it("continues the commitment instead of suggesting another", () => {
    expect(plan.primary).toBe("view_plan");
    expect(plan.reason).toBe("shared_plan");
  });

  it("never proposes a second plan to someone you are already meeting", () => {
    expect(plan.secondary).not.toBe("make_plan");
  });

  it("outranks even a nearby wave", () => {
    const nearbyToo = planActionsForMuddy(
      ctx({ hasSharedUpcomingPlan: true, hasExistingConversation: true, conversationState: "established", isNearby: true })
    );
    expect(nearbyToo.primary).toBe("view_plan");
  });
});

describe("CASE A — new Muddy, never spoken", () => {
  const plan = planActionsForMuddy(ctx());

  it("opens with a message rather than a commitment", () => {
    expect(plan.primary).toBe("say_hi");
    expect(plan.reason).toBe("new_relationship");
  });

  it("keeps a plan available as the quieter option", () => {
    expect(plan.secondary).toBe("make_plan");
  });

  it("does not wave at somebody who has never been messaged", () => {
    // A wave with no prior conversation is a gesture with no context.
    const nearbyStranger = planActionsForMuddy(ctx({ isNearby: true }));
    expect(nearbyStranger.primary).toBe("say_hi");
  });
});

describe("CASE B — nearby, and you have spoken", () => {
  const plan = planActionsForMuddy(ctx({ hasExistingConversation: true, conversationState: "established", isNearby: true }));

  it("offers the one-tap gesture", () => {
    expect(plan.primary).toBe("wave");
    expect(plan.reason).toBe("nearby_can_wave");
  });

  it("keeps messaging one step away", () => {
    expect(plan.secondary).toBe("message");
  });
});

describe("CASE C — established, not nearby", () => {
  const plan = planActionsForMuddy(ctx({ hasExistingConversation: true, conversationState: "established" }));

  it("is where proposing a plan finally makes sense", () => {
    expect(plan.primary).toBe("make_plan");
    expect(plan.reason).toBe("established");
  });
});

describe("fallbacks — never render a button the server will refuse", () => {
  const blocked = planActionsForMuddy(
    ctx({ hasExistingConversation: true, conversationState: "established", isNearby: true, waveAvailable: false })
  );

  it("falls back to a message when Wave is on cooldown", () => {
    expect(blocked.primary).toBe("message");
    expect(blocked.reason).toBe("nearby_wave_blocked");
  });

  it("never offers a blocked Wave in either slot", () => {
    expect(blocked.primary).not.toBe("wave");
    expect(blocked.secondary).not.toBe("wave");
  });

  it("only suppresses Wave when it is genuinely unavailable", () => {
    const allowed = planActionsForMuddy(
      ctx({ hasExistingConversation: true, conversationState: "established", isNearby: true, waveAvailable: true })
    );
    expect(allowed.primary).toBe("wave");
  });
});

describe("the table itself", () => {
  it("is deterministic — the same inputs never drift", () => {
    const input = ctx({ hasExistingConversation: true, conversationState: "established", isNearby: true });
    expect(planActionsForMuddy(input)).toEqual(planActionsForMuddy(input));
  });

  it("always produces a primary action, whatever the combination", () => {
    for (const sharedPlan of [true, false]) {
      for (const conversation of [true, false]) {
        for (const nearby of [true, false]) {
          for (const wave of [true, false]) {
            const plan = planActionsForMuddy(
              ctx({
                hasSharedUpcomingPlan: sharedPlan,
                hasExistingConversation: conversation,
                isNearby: nearby,
                waveAvailable: wave
              })
            );
            expect(typeof plan.primary).toBe("string");
            expect(plan.primary).not.toBe(plan.secondary);
          }
        }
      }
    }
  });

  it("gives a reason for every decision", () => {
    // Each pair is explainable, which is what keeps this a table rather than
    // an opaque score.
    const reasons = new Set<string>();
    /* Varies conversationState, the dimension that actually decides. This
     * looped a boolean that the engine no longer keys on, so a whole branch
     * ("conversation_started") could vanish without changing the count. */
    for (const sharedPlan of [true, false]) {
      for (const conversationState of ["none", "started", "established"] as const) {
        for (const nearby of [true, false]) {
          for (const wave of [true, false]) {
            reasons.add(
              planActionsForMuddy(
                ctx({
                  hasSharedUpcomingPlan: sharedPlan,
                  hasExistingConversation: conversationState !== "none",
                  conversationState,
                  isNearby: nearby,
                  waveAvailable: wave
                })
              ).reason
            );
          }
        }
      }
    }
    // Five branches now: shared plan, new, nearby-can-wave, nearby-blocked,
    // conversation-started, established.
    expect(reasons).toContain("conversation_started");
    expect(reasons.size).toBeGreaterThanOrEqual(5);
  });
});
