import { describe, expect, it } from "vitest";
import {
  accountDoctorSummary,
  buildAccountDoctorFindings,
  type AccountDoctorSnapshot
} from "@/lib/admin/account-doctor";

function snapshot(overrides: Partial<AccountDoctorSnapshot> = {}): AccountDoctorSnapshot {
  return {
    isOnboarded: true,
    visibilityStatus: "visible",
    hasLocationSignal: true,
    staleStatusCount: 0,
    unreadNotificationCount: 0,
    pushDeviceCount: 1,
    activeRateLimitCount: 0,
    activeFriendshipCount: 2,
    pendingFriendRequestCount: 0,
    blockCount: 0,
    archivedDirectWithLiveFriendshipCount: 0,
    nonJoinedDirectMembershipCount: 0,
    planChatMismatchCount: 0,
    planChatBlockedByRuleCount: 0,
    staleOwnedUpForCount: 0,
    strandedUpForRequestCount: 0,
    stalledSafeArrivalCount: 0,
    unconfirmedSafeArrivalCount: 0,
    eventCircleMismatchCount: 0,
    eventBlockedByRuleCount: 0,
    ...overrides
  };
}

describe("Account Doctor", () => {
  it("recommends direct-message reconciliation for an archived live-friendship mismatch", () => {
    const findings = buildAccountDoctorFindings(snapshot({ archivedDirectWithLiveFriendshipCount: 1 }));
    const finding = findings.find((item) => item.id === "direct-conversation-mismatch");
    expect(finding).toMatchObject({ severity: "issue", repairId: "reconcile_direct_messaging" });
  });

  it("recommends canonical Plan Chat reconciliation for participant/chat drift", () => {
    const findings = buildAccountDoctorFindings(snapshot({ planChatMismatchCount: 2 }));
    const finding = findings.find((item) => item.id === "plan-chat-mismatch");
    expect(finding).toMatchObject({ severity: "issue", repairId: "reconcile_plan_chats" });
  });

  it("surfaces expired presence and active rate limits as attention rather than silently mutating them", () => {
    const findings = buildAccountDoctorFindings(snapshot({ staleStatusCount: 1, activeRateLimitCount: 2 }));
    expect(findings.find((item) => item.id === "stale-status")).toMatchObject({
      severity: "attention",
      repairId: "clear_stuck_status"
    });
    expect(findings.find((item) => item.id === "active-rate-limits")).toMatchObject({
      severity: "attention",
      repairId: "clear_rate_limits"
    });
  });

  it("does not treat a missing location signal as a defect", () => {
    const findings = buildAccountDoctorFindings(snapshot({ hasLocationSignal: false }));
    expect(findings.find((item) => item.id === "presence-signal")).toMatchObject({ severity: "info" });
  });

  it("keeps diagnostic-only stale UpFor state visible without inventing a repair", () => {
    const findings = buildAccountDoctorFindings(snapshot({ staleOwnedUpForCount: 1 }));
    const finding = findings.find((item) => item.id === "stale-upfor");
    expect(finding?.severity).toBe("attention");
    expect(finding?.repairId).toBeUndefined();
  });

  it("orders issues ahead of attention, info and healthy findings", () => {
    const findings = buildAccountDoctorFindings(
      snapshot({ archivedDirectWithLiveFriendshipCount: 1, activeRateLimitCount: 1 })
    );
    const ranks = findings.map((item) => item.severity);
    expect(ranks.indexOf("issue")).toBeLessThan(ranks.indexOf("attention"));
    expect(ranks.indexOf("attention")).toBeLessThan(ranks.indexOf("info"));
    expect(ranks.indexOf("info")).toBeLessThan(ranks.lastIndexOf("healthy"));
  });

  it("summarises findings for the Admin UI", () => {
    const findings = buildAccountDoctorFindings(snapshot({ planChatMismatchCount: 1, staleStatusCount: 1 }));
    const summary = accountDoctorSummary(findings);
    expect(summary.issue).toBeGreaterThan(0);
    expect(summary.attention).toBeGreaterThan(0);
    expect(summary.healthy).toBeGreaterThan(0);
  });
});

describe("safety findings are reported without offering a repair", () => {
  it("an unconfirmed arrival is an ISSUE with no repair attached", () => {
    /* The whole point: this must never render a button. An unconfirmed arrival
       means somebody did not check in and their watchers were told, so the
       only correct action is a person looking at it. */
    const findings = buildAccountDoctorFindings(snapshot({ unconfirmedSafeArrivalCount: 2 }));
    const finding = findings.find((item) => item.id === "safe-arrival-unconfirmed");

    expect(finding?.severity).toBe("issue");
    expect(finding?.repairId).toBeUndefined();
    expect(finding?.detail).toMatch(/escalate it rather than closing it/i);
  });

  it("a stalled journey is reported separately from an unconfirmed one", () => {
    const findings = buildAccountDoctorFindings(
      snapshot({ stalledSafeArrivalCount: 1, unconfirmedSafeArrivalCount: 1 })
    );

    expect(findings.find((item) => item.id === "safe-arrival-stalled")).toBeDefined();
    expect(findings.find((item) => item.id === "safe-arrival-unconfirmed")).toBeDefined();
  });

  it("neither appears on a healthy account", () => {
    const findings = buildAccountDoctorFindings(snapshot());

    expect(findings.find((item) => item.id === "safe-arrival-stalled")).toBeUndefined();
    expect(findings.find((item) => item.id === "safe-arrival-unconfirmed")).toBeUndefined();
  });

  it("no safety finding carries a journey detail", () => {
    const findings = buildAccountDoctorFindings(
      snapshot({ stalledSafeArrivalCount: 3, unconfirmedSafeArrivalCount: 2 })
    );
    for (const finding of findings.filter((item) => item.id.startsWith("safe-arrival"))) {
      expect(finding.detail).not.toMatch(/destination|address|route|coordinate|latitude|longitude/i);
    }
  });
});

describe("stranded UpFor requests and Event circles", () => {
  it("reports people left waiting on a closed UpFor", () => {
    const finding = buildAccountDoctorFindings(snapshot({ strandedUpForRequestCount: 4 })).find(
      (item) => item.id === "upfor-stranded-requests"
    );

    expect(finding?.detail).toMatch(/4 requests are still pending/);
  });

  it("reports an Event the account is going to but not joined to", () => {
    const finding = buildAccountDoctorFindings(snapshot({ eventCircleMismatchCount: 1 })).find(
      (item) => item.id === "event-circle-mismatch"
    );

    expect(finding?.severity).toBe("attention");
  });

  it("reports neither when both are clean", () => {
    const findings = buildAccountDoctorFindings(snapshot());
    expect(findings.find((item) => item.id === "upfor-stranded-requests")).toBeUndefined();
    expect(findings.find((item) => item.id === "event-circle-mismatch")).toBeUndefined();
  });
});

describe("Plan Chat separates drift from a correct refusal", () => {
  it("a correct refusal is a product rule with NO repair attached", () => {
    /* The review finding: every Going/Maybe participant missing chat
       membership was counted as drift, so an operator was offered a repair
       button for a Plan the lifecycle is refusing on purpose. */
    const finding = buildAccountDoctorFindings(snapshot({ planChatBlockedByRuleCount: 2 })).find(
      (item) => item.id === "plan-chat-blocked-by-rule"
    );

    expect(finding?.severity).toBe("product_rule");
    expect(finding?.repairId).toBeUndefined();
    expect(finding?.detail).toMatch(/refusing on purpose/i);
  });

  it("genuine drift still offers the canonical reconciler", () => {
    const finding = buildAccountDoctorFindings(snapshot({ planChatMismatchCount: 1 })).find(
      (item) => item.id === "plan-chat-mismatch"
    );

    expect(finding?.repairId).toBe("reconcile_plan_chats");
  });

  it("both can be reported at once without either hiding the other", () => {
    const findings = buildAccountDoctorFindings(
      snapshot({ planChatMismatchCount: 1, planChatBlockedByRuleCount: 1 })
    );

    expect(findings.find((item) => item.id === "plan-chat-mismatch")).toBeDefined();
    expect(findings.find((item) => item.id === "plan-chat-blocked-by-rule")).toBeDefined();
  });

  it("a healthy account reports neither", () => {
    const findings = buildAccountDoctorFindings(snapshot());
    expect(findings.find((item) => item.id === "plan-chat-blocked-by-rule")).toBeUndefined();
  });
});
