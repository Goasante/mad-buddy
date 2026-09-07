import { describe, expect, it } from "vitest";

import type { AccountDoctorFinding } from "@/lib/admin/account-doctor";
import {
  combineAccountDoctorFindings,
  summarizeCombinedFindings,
  unavailableSupportOwnedFinding
} from "@/lib/admin/combined-doctor";
import type { SupportOwnedDiagnostic } from "@/lib/admin/support-owned-diagnostics";

const base = (overrides: Partial<AccountDoctorFinding> = {}): AccountDoctorFinding => ({
  id: "direct-messaging-healthy",
  area: "Messaging",
  severity: "healthy",
  title: "Direct messaging lifecycle looks healthy",
  detail: "No mismatch.",
  ...overrides
});

const owned = (overrides: Partial<SupportOwnedDiagnostic> = {}): SupportOwnedDiagnostic => ({
  id: "dob-state",
  areaId: "dob-age",
  severity: "product_rule",
  title: "18+ features are correctly unavailable",
  detail: "This is intentional.",
  operatorAction: "explain_product_rule",
  ...overrides
});

describe("combined Account Doctor projection", () => {
  it("keeps lifecycle-heavy findings owned by the base Doctor", () => {
    const safety = base({
      id: "safe-arrival-unconfirmed",
      area: "Account",
      severity: "issue",
      title: "A journey ended without confirmed arrival",
      detail: "Escalate it."
    });

    const findings = combineAccountDoctorFindings([safety], []);
    expect(findings).toContainEqual(expect.objectContaining({
      id: "safe-arrival-unconfirmed",
      severity: "issue"
    }));
    expect(findings[0]?.repairId).toBeUndefined();
  });

  it("replaces only baseline findings that the richer support model owns", () => {
    const findings = combineAccountDoctorFindings(
      [
        base({ id: "account-setup", area: "Account", title: "Old onboarding" }),
        base({ id: "notification-summary", area: "Notifications", severity: "info", title: "Old notifications" }),
        base({ id: "plan-chat-healthy", area: "Plans", title: "Plan Chat healthy" })
      ],
      [owned({ id: "onboarding-state", areaId: "onboarding-activation", severity: "healthy", title: "New onboarding", operatorAction: "none" })]
    );

    expect(findings.some((finding) => finding.id === "account-setup")).toBe(false);
    expect(findings.some((finding) => finding.id === "notification-summary")).toBe(false);
    expect(findings.some((finding) => finding.id === "plan-chat-healthy")).toBe(true);
    expect(findings.some((finding) => finding.id === "owned:onboarding-state")).toBe(true);
  });

  it("keeps product rules first-class and never turns them into a repair button", () => {
    const findings = combineAccountDoctorFindings([], [
      owned({ repairId: "reset_onboarding", operatorAction: "explain_product_rule" })
    ]);
    const finding = findings[0];

    expect(finding?.severity).toBe("product_rule");
    expect(finding?.repairId).toBeUndefined();
    expect(summarizeCombinedFindings(findings).productRule).toBe(1);
  });

  it("passes a repair id through only for an explicit named-repair action", () => {
    const findings = combineAccountDoctorFindings([], [
      owned({
        id: "presence-status-expiry",
        areaId: "presence",
        severity: "attention",
        operatorAction: "use_named_repair",
        repairId: "clear_stuck_status"
      })
    ]);

    expect(findings[0]).toMatchObject({
      severity: "attention",
      repairId: "clear_stuck_status"
    });
  });

  it("orders real defects above product rules and healthy context", () => {
    const findings = combineAccountDoctorFindings(
      [base({ id: "base-issue", severity: "issue" })],
      [
        owned(),
        owned({ id: "healthy", areaId: "profile-media", severity: "healthy", operatorAction: "none" })
      ]
    );

    expect(findings.map((finding) => finding.severity)).toEqual(["issue", "product_rule", "healthy"]);
  });

  it("fails closed when the extended diagnostic loader is unavailable", () => {
    expect(unavailableSupportOwnedFinding()).toMatchObject({
      severity: "issue",
      operatorAction: "escalate"
    });
  });
});
