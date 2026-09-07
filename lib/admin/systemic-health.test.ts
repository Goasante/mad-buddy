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
  it("keeps one or two affected accounts in the isolated support path", () => {
    expect(assessSystemicHealth(signal({ affectedAccounts: 1 })).severity).toBe("normal");
    expect(assessSystemicHealth(signal({ affectedAccounts: 2 })).severity).toBe("normal");
  });

  it("moves repeated drift into watch at three affected accounts", () => {
    const result = assessSystemicHealth(signal({ affectedAccounts: 3 }));
    expect(result.severity).toBe("watch");
    expect(result.guidance).toContain("Repeated account drift");
  });

  it("marks ten or more affected accounts as a possible systemic defect", () => {
    const result = assessSystemicHealth(signal({ affectedAccounts: 10 }));
    expect(result.severity).toBe("systemic");
    expect(result.guidance).toContain("Possible systemic defect");
  });

  it("allows an explicit engineering escalation to outrank low counts", () => {
    const result = assessSystemicHealth(signal({ affectedAccounts: 1, engineeringEscalation: true }));
    expect(result.severity).toBe("systemic");
  });

  it("normalises impossible negative counts to zero", () => {
    expect(assessSystemicHealth(signal({ affectedAccounts: -4 })).affectedAccounts).toBe(0);
  });

  it("sorts systemic first, then watch, then isolated", () => {
    const sorted = sortSystemicHealth([
      signal({ id: "normal", affectedAccounts: 1 }),
      signal({ id: "systemic", affectedAccounts: 22 }),
      signal({ id: "watch", affectedAccounts: 4 })
    ]);
    expect(sorted.map((item) => item.id)).toEqual(["systemic", "watch", "normal"]);
  });
});
