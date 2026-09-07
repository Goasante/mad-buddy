import { describe, expect, it } from "vitest";

import {
  explainCapacity,
  explainPlanChatAccess,
  findStaleUpForSessions,
  findStrandedRequests,
  isPlanOpen,
  type PlanParticipationView,
  type UpForSessionView,
  verifyRequestsSettled,
  verifyUpForExpiry
} from "@/lib/admin/plan-upfor-diagnostics";

/**
 * The canonical lifecycle refuses in fourteen distinct ways and every one of
 * them is the product working. So most of these cases assert that a refusal is
 * explained rather than repaired -- and one asserts the opposite of what this
 * file would have said before 20260907120000 shipped.
 */

const NOW = new Date("2026-09-07T12:00:00Z");

const session = (overrides: Partial<UpForSessionView> = {}): UpForSessionView => ({
  sessionId: "session-1",
  status: "active",
  endsAt: "2026-09-07T18:00:00Z",
  acceptedCount: 0,
  pendingCount: 0,
  maxParticipants: 10,
  convertedPlanId: null,
  ...overrides
});

const plan = (overrides: Partial<PlanParticipationView> = {}): PlanParticipationView => ({
  planId: "plan-1",
  planStatus: "confirmed",
  rsvpStatus: "going",
  conversationExists: true,
  joinedConversation: true,
  sourceHangoutId: null,
  acceptedOnSourceHangout: false,
  muddyWithCreator: true,
  blockedWithCreator: false,
  ...overrides
});

describe("an UpFor running past its end time is real drift", () => {
  it("finds an active session whose end time has passed", () => {
    const found = findStaleUpForSessions([session({ endsAt: "2026-09-07T09:00:00Z" })], NOW);

    expect(found).toHaveLength(1);
    expect(found[0].repairable).toBe(true);
  });

  it("finds a full session past its end time too", () => {
    expect(findStaleUpForSessions([session({ status: "full", endsAt: "2026-09-07T09:00:00Z" })], NOW)).toHaveLength(1);
  });

  it("leaves a session that has not finished yet alone", () => {
    expect(findStaleUpForSessions([session()], NOW)).toEqual([]);
  });

  it("leaves an open-ended session alone", () => {
    expect(findStaleUpForSessions([session({ endsAt: null })], NOW)).toEqual([]);
  });

  it("never touches a PAUSED session, however old — the owner chose that", () => {
    expect(findStaleUpForSessions([session({ status: "paused", endsAt: "2026-01-01T00:00:00Z" })], NOW)).toEqual([]);
  });

  it("ignores sessions that already ended properly", () => {
    for (const status of ["expired", "cancelled", "converted_to_plan"] as const) {
      expect(findStaleUpForSessions([session({ status, endsAt: "2026-01-01T00:00:00Z" })], NOW)).toEqual([]);
    }
  });
});

describe("requests stranded on a closed UpFor", () => {
  it("finds people still waiting on a cancelled session", () => {
    const found = findStrandedRequests([session({ status: "cancelled", pendingCount: 3 })]);

    expect(found).toHaveLength(1);
    expect(found[0].explanation).toMatch(/3 requests are still waiting/);
  });

  it("finds them on a converted session, where the Plan already exists", () => {
    expect(findStrandedRequests([session({ status: "converted_to_plan", pendingCount: 1 })])).toHaveLength(1);
  });

  it("leaves pending requests on a LIVE session alone — that is just waiting", () => {
    expect(findStrandedRequests([session({ status: "active", pendingCount: 5 })])).toEqual([]);
  });

  it("reports nothing when a closed session has no pending requests", () => {
    expect(findStrandedRequests([session({ status: "expired", pendingCount: 0 })])).toEqual([]);
  });
});

describe("a full UpFor is a decision, not a fault", () => {
  it("explains capacity rather than offering a repair", () => {
    const result = explainCapacity(session({ status: "full" }));

    expect(result.outcome).toBe("blocked_by_product_rule");
    expect(result.summary).toMatch(/only its owner can make room/i);
  });

  it("counts a session at its limit as full even when the status lags", () => {
    expect(explainCapacity(session({ acceptedCount: 10, maxParticipants: 10 })).outcome).toBe(
      "blocked_by_product_rule"
    );
  });

  it("says capacity is not the problem when there is room", () => {
    expect(explainCapacity(session({ acceptedCount: 2, maxParticipants: 10 })).outcome).toBe("fixed");
  });
});

describe("why an account cannot reach a Plan Chat", () => {
  it("a block outranks Plan participation", () => {
    const result = explainPlanChatAccess(plan({ blockedWithCreator: true, joinedConversation: false }));

    expect(result.outcome).toBe("blocked_by_product_rule");
    expect(result.rule).toMatch(/block outranks/i);
  });

  it("a removed participant is told they were REMOVED, not that they need a friendship", () => {
    /* The dangerous case: re-adding the friendship changes nothing, so sending
       them to do it wastes the user's time and the operator's. */
    const result = explainPlanChatAccess(
      plan({ rsvpStatus: "removed", muddyWithCreator: false, joinedConversation: false })
    );

    expect(result.rule).toMatch(/removed participant stays removed/i);
    expect(result.summary).toMatch(/would change nothing/i);
  });

  it("answering no keeps them out, and that is theirs to change", () => {
    const result = explainPlanChatAccess(plan({ rsvpStatus: "not_going", joinedConversation: false }));

    expect(result.outcome).toBe("blocked_by_product_rule");
    expect(result.summary).toMatch(/theirs to do/i);
  });

  it("a finished Plan keeps its chat closed", () => {
    for (const planStatus of ["cancelled", "completed", "expired"] as const) {
      const result = explainPlanChatAccess(plan({ planStatus, joinedConversation: false }));
      expect(result.outcome).toBe("blocked_by_product_rule");
    }
  });

  it("POST-PR#34: a non-Muddy accepted onto the source UpFor is ELIGIBLE", () => {
    /* Before 20260907120000 this would have been "not a Muddy, not eligible".
       Saying that now would tell a legitimate participant to go and add a
       friendship the product does not require of them. */
    const result = explainPlanChatAccess(
      plan({
        muddyWithCreator: false,
        sourceHangoutId: "session-1",
        acceptedOnSourceHangout: true,
        joinedConversation: false
      })
    );

    expect(result.outcome).toBe("still_broken");
    expect(result.summary).toMatch(/eligible for the Plan Chat/i);
  });

  it("but a stranger with no accepted request is correctly ineligible", () => {
    const result = explainPlanChatAccess(
      plan({ muddyWithCreator: false, sourceHangoutId: "session-1", acceptedOnSourceHangout: false })
    );

    expect(result.outcome).toBe("blocked_by_product_rule");
    expect(result.rule).toMatch(/source UpFor/i);
  });

  it("a missing chat on an open Plan is nothing to repair, not a fault", () => {
    const result = explainPlanChatAccess(plan({ conversationExists: false, joinedConversation: false }));

    expect(result.outcome).toBe("not_applicable");
  });

  it("an eligible member who is simply not joined IS a fault", () => {
    const result = explainPlanChatAccess(plan({ joinedConversation: false }));

    expect(result.outcome).toBe("still_broken");
  });

  it("a joined member is healthy", () => {
    expect(explainPlanChatAccess(plan()).outcome).toBe("fixed");
  });
});

describe("plan open/closed", () => {
  it("treats draft, inviting, polling and confirmed as open", () => {
    for (const s of ["draft", "inviting", "polling", "confirmed"] as const) expect(isPlanOpen(s)).toBe(true);
  });

  it("treats cancelled, completed and expired as closed", () => {
    for (const s of ["cancelled", "completed", "expired"] as const) expect(isPlanOpen(s)).toBe(false);
  });
});

describe("the verifiers claim only what their repair did", () => {
  it("settling requests says nobody was added to anything", () => {
    const result = verifyRequestsSettled({ attempted: 4, remainingPending: 0 });

    expect(result.outcome).toBe("fixed");
    expect(result.summary).toMatch(/nobody was added/i);
  });

  it("settling reports still broken when requests survive", () => {
    expect(verifyRequestsSettled({ attempted: 4, remainingPending: 2 }).outcome).toBe("still_broken");
  });

  it("expiry says existing Plans and participants are untouched", () => {
    const result = verifyUpForExpiry({ attempted: 2, stillLive: 0 });

    expect(result.outcome).toBe("fixed");
    expect(result.summary).toMatch(/existing Plans and accepted participants are untouched/i);
  });

  it("expiry reports still broken when a session stays live", () => {
    expect(verifyUpForExpiry({ attempted: 2, stillLive: 1 }).outcome).toBe("still_broken");
  });

  it("both report nothing-to-do rather than success when there was no drift", () => {
    expect(verifyRequestsSettled({ attempted: 0, remainingPending: 0 }).outcome).toBe("not_applicable");
    expect(verifyUpForExpiry({ attempted: 0, stillLive: 0 }).outcome).toBe("not_applicable");
  });
});
