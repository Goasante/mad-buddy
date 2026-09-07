import { describe, expect, it } from "vitest";

import {
  explainMessagingEligibility,
  findReciprocalRequests,
  findRelationshipIssues,
  isBlockedEitherWay,
  type RelationshipPair,
  verifyRequestSettlement
} from "@/lib/admin/relationship-diagnostics";

/**
 * Most of what follows is negative, and deliberately so. The risk in these two
 * areas is not that Admin fails to fix something; it is that Admin "fixes" a
 * relationship the two people did not consent to, or explains a block in a way
 * that tells somebody who blocked them.
 */

const pair = (overrides: Partial<RelationshipPair> = {}): RelationshipPair => ({
  otherUserId: "00000000-0000-4000-8000-0000000000aa",
  friendshipLive: false,
  friendshipRowExists: false,
  blocksThem: false,
  blockedByThem: false,
  pendingRequest: false,
  ...overrides
});

describe("a block is read in both directions", () => {
  it("counts a block this account made", () => {
    expect(isBlockedEitherWay(pair({ blocksThem: true }))).toBe(true);
  });

  it("counts a block made against this account", () => {
    expect(isBlockedEitherWay(pair({ blockedByThem: true }))).toBe(true);
  });

  it("is false only when neither side blocks", () => {
    expect(isBlockedEitherWay(pair())).toBe(false);
  });
});

describe("stale request rows are drift Admin may settle", () => {
  it("finds a request still pending for a pair who are already Muddies", () => {
    const issues = findRelationshipIssues([pair({ friendshipLive: true, pendingRequest: true })]);

    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe("pending_request_while_friends");
    expect(issues[0].repairable).toBe(true);
  });

  it("finds a request still pending for a blocked pair", () => {
    const issues = findRelationshipIssues([pair({ blocksThem: true, pendingRequest: true })]);

    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe("pending_request_while_blocked");
  });

  it("reads a blocked pair as blocked even when they are also still friends", () => {
    // Block wins the classification, so the explanation cannot imply the
    // request is merely redundant bookkeeping between friends.
    const issues = findRelationshipIssues([
      pair({ friendshipLive: true, blockedByThem: true, pendingRequest: true })
    ]);

    expect(issues[0].kind).toBe("pending_request_while_blocked");
  });
});

describe("what is NOT an issue", () => {
  it("an ended friendship with no pending request is a normal outcome", () => {
    expect(findRelationshipIssues([pair({ friendshipRowExists: true })])).toEqual([]);
  });

  it("a pending request between strangers is the product working", () => {
    expect(findRelationshipIssues([pair({ pendingRequest: true })])).toEqual([]);
  });

  it("a block with no pending request is a decision, fully applied", () => {
    expect(findRelationshipIssues([pair({ blocksThem: true })])).toEqual([]);
  });

  it("an account with nothing pending produces nothing", () => {
    expect(findRelationshipIssues([pair(), pair({ friendshipLive: true })])).toEqual([]);
  });
});

describe("reciprocal requests are explained, never answered", () => {
  it("is reported but not repairable", () => {
    const issues = findReciprocalRequests([pair({ pendingRequest: true, pendingBothDirections: true })]);

    expect(issues).toHaveLength(1);
    expect(issues[0].repairable).toBe(false);
    expect(issues[0].explanation).toMatch(/must not answer for either/i);
  });

  it("a one-directional request is not mistaken for a reciprocal one", () => {
    expect(findReciprocalRequests([pair({ pendingRequest: true })])).toEqual([]);
  });

  it("unknown direction is not treated as both directions", () => {
    // pendingBothDirections is explicit; absence must never mean "both".
    expect(findReciprocalRequests([pair({ pendingRequest: true, pendingBothDirections: undefined })])).toEqual([]);
  });
});

describe("why a pair cannot message", () => {
  it("a block outranks everything and never names who set it", () => {
    const result = explainMessagingEligibility(pair({ friendshipLive: true, blockedByThem: true }));

    expect(result.outcome).toBe("blocked_by_product_rule");
    expect(result.summary).not.toMatch(/they blocked|blocked you|who blocked/i);
    expect(result.summary).toMatch(/must not say who set it/i);
  });

  it("a blocked pair who are also not Muddies is explained as BLOCKED", () => {
    /* The dangerous case. Telling them "you're not Muddies" would send them to
       re-add somebody who has blocked them, and the re-add would fail with a
       message that reveals nothing -- so they would try again. */
    const result = explainMessagingEligibility(pair({ blocksThem: true, friendshipRowExists: true }));

    expect(result.outcome).toBe("blocked_by_product_rule");
    expect(result.rule).toMatch(/block outranks/i);
  });

  it("a lapsed friendship is explained without Admin recreating it", () => {
    const result = explainMessagingEligibility(pair({ friendshipRowExists: true }));

    expect(result.outcome).toBe("blocked_by_product_rule");
    expect(result.summary).toMatch(/must not recreate/i);
  });

  it("two strangers are told the relationship does not exist yet", () => {
    const result = explainMessagingEligibility(pair());

    expect(result.outcome).toBe("blocked_by_product_rule");
    expect(result.summary).toMatch(/never been Muddies/i);
  });

  it("current unblocked Muddies are permitted", () => {
    const result = explainMessagingEligibility(pair({ friendshipLive: true, friendshipRowExists: true }));

    expect(result.outcome).toBe("fixed");
  });
});

describe("the settlement verifier claims only what the repair did", () => {
  it("reports nothing to do when there was no drift", () => {
    expect(verifyRequestSettlement({ attempted: 0, remainingPending: 0, blockedPairsRemaining: 0 }).outcome).toBe(
      "not_applicable"
    );
  });

  it("reports still broken when rows survive the repair", () => {
    const result = verifyRequestSettlement({ attempted: 3, remainingPending: 1, blockedPairsRemaining: 0 });

    expect(result.outcome).toBe("still_broken");
    expect(result.summary).toMatch(/1 stale request/);
  });

  it("says explicitly that no friendship or block was changed", () => {
    const result = verifyRequestSettlement({ attempted: 2, remainingPending: 0, blockedPairsRemaining: 0 });

    expect(result.outcome).toBe("fixed");
    expect(result.summary).toMatch(/no friendship or block was created, changed or removed/i);
  });

  it("notes that surviving blocks are correct rather than leftover damage", () => {
    const result = verifyRequestSettlement({ attempted: 2, remainingPending: 0, blockedPairsRemaining: 2 });

    expect(result.summary).toMatch(/2 pairs remain blocked, which is correct/i);
  });
});
