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
    staleOwnedUpForCount: 0,
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
