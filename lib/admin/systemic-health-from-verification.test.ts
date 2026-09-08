import { describe, expect, it } from "vitest";
import { assessSystemicHealth } from "@/lib/admin/systemic-health";
import { countOutcomes, systemicSignalFromVerifications } from "@/lib/admin/systemic-health-from-verification";
import type { RepairOutcome } from "@/lib/admin/repair-verification";

const observation = (outcome: RepairOutcome) => ({ outcome });

describe("verification outcomes are the authority for systemic counts", () => {
  it("counts only still-broken and product-rule cases as affected", () => {
    const signal = systemicSignalFromVerifications({
      id: "upfor-expiry",
      area: "UpFor",
      label: "Expired active UpFor",
      verifications: [
        observation("still_broken"),
        observation("blocked_by_product_rule"),
        observation("fixed"),
        observation("not_applicable")
      ],
      firstObservedAt: null,
      lastObservedAt: null,
      repairablePerAccount: true
    });

    expect(signal.affectedAccounts).toBe(2);
    expect(signal.productRuleAccounts).toBe(1);
    expect(assessSystemicHealth(signal).actionableAffectedAccounts).toBe(1);
  });

  it("cannot turn a pile of correct product refusals into a systemic defect", () => {
    const signal = systemicSignalFromVerifications({
      id: "plan-access",
      area: "Plans",
      label: "Plan access refusal",
      verifications: Array.from({ length: 25 }, () => observation("blocked_by_product_rule")),
      firstObservedAt: null,
      lastObservedAt: null,
      repairablePerAccount: false,
      engineeringEscalation: true
    });

    const assessment = assessSystemicHealth(signal);
    expect(assessment.severity).toBe("normal");
    expect(assessment.actionableAffectedAccounts).toBe(0);
    expect(assessment.productRuleAccounts).toBe(25);
  });

  it("three still-broken invariants become watch regardless of healthy observations", () => {
    const signal = systemicSignalFromVerifications({
      id: "stranded-upfor-requests",
      area: "UpFor",
      label: "Requests stranded on terminal UpFor",
      verifications: [
        observation("still_broken"),
        observation("still_broken"),
        observation("still_broken"),
        ...Array.from({ length: 20 }, () => observation("fixed"))
      ],
      firstObservedAt: null,
      lastObservedAt: null,
      repairablePerAccount: true
    });

    expect(assessSystemicHealth(signal).severity).toBe("watch");
  });

  it("legacy-only still-broken rows remain cleanup backlog", () => {
    const signal = systemicSignalFromVerifications({
      id: "legacy-request-while-friends",
      area: "Relationships",
      label: "Pending request between current Muddies",
      verifications: Array.from({ length: 40 }, () => observation("still_broken")),
      firstObservedAt: null,
      lastObservedAt: null,
      repairablePerAccount: true,
      recurrenceAuthority: "legacy_only"
    });

    const assessment = assessSystemicHealth(signal);
    expect(assessment.severity).toBe("normal");
    expect(assessment.recurrenceEvidenceEligible).toBe(false);
    expect(assessment.actionableAffectedAccounts).toBe(40);
  });

  it("keeps all four outcomes explicit", () => {
    expect(countOutcomes(["fixed", "still_broken", "not_applicable", "blocked_by_product_rule"])).toEqual({
      fixed: 1,
      still_broken: 1,
      not_applicable: 1,
      blocked_by_product_rule: 1
    });
  });
});
