import { describe, expect, it } from "vitest";
import { assessSystemicHealth, sortSystemicHealth, type SystemicHealthSignal } from "@/lib/admin/systemic-health";

function signal(overrides: Partial<SystemicHealthSignal> = {}): SystemicHealthSignal {
  return {
    id: "direct-message-drift",
    area: "Messaging",
    label: "Archived direct conversation despite live unblocked friendship",
    affectedAccounts: 1,
    firstObservedAt: null,
    lastObservedAt: null,
    repairablePerAccount: true,
    engineeringEscalation: false,
    ...overrides
  };
}

describe("systemic health classification", () => {
  it("keeps one or two broken accounts in the isolated support path", () => {
    expect(assessSystemicHealth(signal({ affectedAccounts: 1 })).severity).toBe("normal");
    expect(assessSystemicHealth(signal({ affectedAccounts: 2 })).severity).toBe("normal");
  });

  it("moves repeated drift into watch at three actually-broken accounts", () => {
    const result = assessSystemicHealth(signal({ affectedAccounts: 3 }));
    expect(result.severity).toBe("watch");
    expect(result.actionableAffectedAccounts).toBe(3);
    expect(result.guidance).toContain("Repeated account drift");
  });

  it("marks ten or more broken accounts as a possible systemic defect", () => {
    const result = assessSystemicHealth(signal({ affectedAccounts: 10 }));
    expect(result.severity).toBe("systemic");
    expect(result.guidance).toContain("Possible systemic defect");
  });

  it("allows an explicit engineering escalation to outrank low broken counts", () => {
    const result = assessSystemicHealth(signal({ affectedAccounts: 1, engineeringEscalation: true }));
    expect(result.severity).toBe("systemic");
  });

  it("never promotes valid product-rule refusals into a systemic defect", () => {
    const result = assessSystemicHealth(
      signal({ affectedAccounts: 20, productRuleAccounts: 20, engineeringEscalation: true })
    );
    expect(result.severity).toBe("normal");
    expect(result.actionableAffectedAccounts).toBe(0);
    expect(result.productRuleAccounts).toBe(20);
    expect(result.guidance).toContain("product rules");
  });

  it("subtracts product-rule cases before applying recurrence thresholds", () => {
    const watch = assessSystemicHealth(signal({ affectedAccounts: 12, productRuleAccounts: 9 }));
    expect(watch.actionableAffectedAccounts).toBe(3);
    expect(watch.severity).toBe("watch");

    const isolated = assessSystemicHealth(signal({ affectedAccounts: 12, productRuleAccounts: 10 }));
    expect(isolated.actionableAffectedAccounts).toBe(2);
    expect(isolated.severity).toBe("normal");
  });

  it("does not classify a legacy-only backlog as recurrence regardless of count", () => {
    const result = assessSystemicHealth(
      signal({ affectedAccounts: 40, recurrenceAuthority: "legacy_only", engineeringEscalation: true })
    );
    expect(result.severity).toBe("normal");
    expect(result.actionableAffectedAccounts).toBe(40);
    expect(result.recurrenceEvidenceEligible).toBe(false);
    expect(result.guidance).toContain("Legacy-only drift");
    expect(result.guidance).toContain("audit the predicate/database invariant");
  });

  it("defaults ordinary predicates to recurring authority", () => {
    const result = assessSystemicHealth(signal({ affectedAccounts: 3 }));
    expect(result.recurrenceAuthority).toBe("recurring");
    expect(result.recurrenceEvidenceEligible).toBe(true);
  });

  it("caps impossible product-rule counts at the observed account count", () => {
    const result = assessSystemicHealth(signal({ affectedAccounts: 2, productRuleAccounts: 99 }));
    expect(result.productRuleAccounts).toBe(2);
    expect(result.actionableAffectedAccounts).toBe(0);
  });

  it("normalises impossible negative counts to zero", () => {
    const result = assessSystemicHealth(signal({ affectedAccounts: -4, productRuleAccounts: -2 }));
    expect(result.affectedAccounts).toBe(0);
    expect(result.productRuleAccounts).toBe(0);
  });

  it("sorts systemic first, then watch, then recurring isolated before legacy-only backlog", () => {
    const sorted = sortSystemicHealth([
      signal({ id: "legacy", affectedAccounts: 40, recurrenceAuthority: "legacy_only" }),
      signal({ id: "normal", affectedAccounts: 20, productRuleAccounts: 19 }),
      signal({ id: "systemic", affectedAccounts: 22 }),
      signal({ id: "watch", affectedAccounts: 14, productRuleAccounts: 10 })
    ]);
    expect(sorted.map((item) => item.id)).toEqual(["systemic", "watch", "normal", "legacy"]);
  });
});
