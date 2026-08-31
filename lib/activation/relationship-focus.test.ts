import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/lib/content/strip-comments";
import { selectRelationshipFocus, type FocusCandidate } from "@/lib/activation/relationship-focus";

/**
 * Home names a person, not an errand.
 *
 * "Message a Muddy" on a screen that knows exactly which Muddy somebody has is
 * the product forgetting the relationship that just activated it.
 */

const NOW = Date.UTC(2026, 7, 15, 20, 0, 0);
const ago = (ms: number) => NOW - ms;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const muddy = (id: string, over: Partial<FocusCandidate> = {}): FocusCandidate => ({
  id,
  displayName: `Muddy ${id}`,
  avatarUrl: null,
  connectedAtMs: ago(DAY),
  hasSharedUpcomingPlan: false,
  // A thread nobody has spoken in is still "none": the row is not evidence.
  conversationState: "none",
  lastConversationActivityMs: null,
  waveAvailable: true,
  ...over
});

describe("a brand-new relationship", () => {
  const focus = selectRelationshipFocus([muddy("a")]);

  it("offers the lowest-friction opening", () => {
    // Saying hello costs nothing. Asking for a commitment is a lot to ask of
    // a connection that is hours old.
    expect(focus?.plan.primary).toBe("say_hi");
  });

  it("keeps a Plan available, but second", () => {
    expect(focus?.plan.secondary).toBe("make_plan");
  });

  it("explains itself", () => {
    expect(focus?.plan.reason).toBe("new_relationship");
  });

  it("carries the real person", () => {
    expect(focus?.muddy.id).toBe("a");
    expect(focus?.muddy.displayName).toBe("Muddy a");
  });

  it("exposes identity only", () => {
    /* No proximity, no band, no distance -- this row is about relevance and
     * must not borrow the nearby vocabulary. */
    expect(Object.keys(focus!.muddy).sort()).toEqual(["avatarUrl", "displayName", "id"]);
  });
});

describe("something already arranged outranks a suggestion", () => {
  const focus = selectRelationshipFocus([
    muddy("new", { connectedAtMs: ago(HOUR) }),
    muddy("planned", { hasSharedUpcomingPlan: true, conversationState: "established" })
  ]);

  it("picks the person you are already meeting", () => {
    expect(focus?.muddy.id).toBe("planned");
  });

  it("opens the Plan rather than proposing a second one", () => {
    expect(focus?.plan.primary).toBe("view_plan");
    expect(focus?.plan.secondary).not.toBe("make_plan");
    expect(focus?.plan.reason).toBe("shared_plan");
  });
});

describe("choosing between several Muddies", () => {
  it("prefers the relationship nobody has spoken in", () => {
    // That silence is the gap activation exists to close.
    const focus = selectRelationshipFocus([
      muddy("chatty", { conversationState: "established", lastConversationActivityMs: ago(HOUR) }),
      muddy("silent", { connectedAtMs: ago(3 * DAY) })
    ]);
    expect(focus?.muddy.id).toBe("silent");
    expect(focus?.plan.primary).toBe("say_hi");
  });

  it("takes the newest of several silent ones", () => {
    const focus = selectRelationshipFocus([
      muddy("old", { connectedAtMs: ago(9 * DAY) }),
      muddy("recent", { connectedAtMs: ago(HOUR) })
    ]);
    expect(focus?.muddy.id).toBe("recent");
  });

  it("falls back to the most recently active conversation", () => {
    const focus = selectRelationshipFocus([
      muddy("stale", { conversationState: "established", lastConversationActivityMs: ago(9 * DAY) }),
      muddy("live", { conversationState: "established", lastConversationActivityMs: ago(HOUR) })
    ]);
    expect(focus?.muddy.id).toBe("live");
    /* An ESTABLISHED, not-nearby relationship gets make_plan/message -- the
     * engine's "established" branch. My first expectation here was message
     * primary, which confused §10's rule about what Message DOES with where
     * it ranks. Somebody you already talk to and cannot wave at is exactly
     * who a plan is worth proposing to. */
    expect(focus?.plan.primary).toBe("make_plan");
    expect(focus?.plan.secondary).toBe("message");
    expect(focus?.plan.reason).toBe("established");
  });

  it("is stable when two connections share a timestamp", () => {
    /* Without the id tiebreak this depended on database row order, and the
     * card would swap people between refreshes for no visible reason. */
    const same = { connectedAtMs: ago(HOUR) };
    const pair = [muddy("b", same), muddy("a", same)];
    expect(selectRelationshipFocus(pair)?.muddy.id).toBe("a");
    expect(selectRelationshipFocus([...pair].reverse())?.muddy.id).toBe("a");
  });

  it("is deterministic across repeated calls", () => {
    const set = [muddy("x"), muddy("y", { connectedAtMs: ago(2 * DAY) }), muddy("z")];
    const first = selectRelationshipFocus(set);
    for (let i = 0; i < 5; i += 1) {
      expect(selectRelationshipFocus(set)).toEqual(first);
    }
  });

  it("does not mutate the caller's list", () => {
    const set = [muddy("b"), muddy("a")];
    const order = set.map((c) => c.id);
    selectRelationshipFocus(set);
    expect(set.map((c) => c.id)).toEqual(order);
  });
});

describe("never offers what the server would refuse", () => {
  it("does not suggest a Wave from the no-nearby card", () => {
    // Waving at somebody who is not around is a gesture with no context.
    const focus = selectRelationshipFocus([
      muddy("a", { conversationState: "established", lastConversationActivityMs: ago(HOUR) })
    ]);
    expect(focus?.plan.primary).not.toBe("wave");
    expect(focus?.plan.secondary).not.toBe("wave");
  });

  it("offers no Wave whatever the cooldown says, off the nearby card", () => {
    /* isNearby is false by construction here, so the cooldown cannot change
     * the outcome -- both branches avoid Wave. That is the point: this card
     * can never render a button the server would bounce. */
    for (const waveAvailable of [true, false]) {
      const focus = selectRelationshipFocus([
        muddy("a", {
          conversationState: "established",
          lastConversationActivityMs: ago(HOUR),
          waveAvailable
        })
      ]);
      expect(focus?.plan.primary).not.toBe("wave");
      expect(focus?.plan.secondary).not.toBe("wave");
      expect(focus?.plan.reason).toBe("established");
    }
  });
});

describe("nothing to say", () => {
  it("returns null with no Muddies", () => {
    expect(selectRelationshipFocus([])).toBeNull();
  });
});

describe("it reuses the one decision engine", () => {
  const source = stripComments(readFileSync("lib/activation/relationship-focus.ts", "utf8"));

  it("delegates the action choice rather than re-deciding it", () => {
    expect(source).toContain("planActionsForMuddy");
  });

  it("implements no second action hierarchy", () => {
    // A local "if nearby then wave" here would be a competing answer.
    expect(source).not.toContain('"wave"');
    expect(source).not.toContain('"say_hi"');
  });

  it("consumes no proximity signal", () => {
    for (const leak of ["proximity", "distance", "band", "glow_strength", "latitude"]) {
      expect(source).not.toContain(leak);
    }
  });

  it("uses no score or ranking model", () => {
    for (const banned of ["score", "weight", "rank(", "Math.random"]) {
      expect(source).not.toContain(banned);
    }
  });
});
