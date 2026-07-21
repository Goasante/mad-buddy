import { describe, expect, it } from "vitest";
import {
  allowedRepairs,
  getRepair,
  REPAIR_CATALOG,
  repairRiskTone,
  repairsByCategory,
  type RepairDefinition
} from "@/lib/admin/repairs";
import { ADMIN_PERMISSIONS, type AdminPermission } from "@/lib/admin/governance";

describe("repair catalog integrity", () => {
  it("has unique ids", () => {
    const ids = REPAIR_CATALOG.map((repair) => repair.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("references only real admin permissions", () => {
    for (const repair of REPAIR_CATALOG) {
      expect(ADMIN_PERMISSIONS).toContain(repair.permission);
    }
  });

  it("requires confirmation and a reason for high-risk repairs", () => {
    for (const repair of REPAIR_CATALOG.filter((r) => r.risk === "high")) {
      expect(repair.confirm).toBe(true);
      expect(repair.requiresReason).toBe(true);
    }
  });

  it("confirms every medium+ risk repair", () => {
    for (const repair of REPAIR_CATALOG.filter((r) => r.risk !== "low")) {
      expect(repair.confirm).toBe(true);
    }
  });

  it("gives every repair an effect description for the operator", () => {
    for (const repair of REPAIR_CATALOG) {
      expect(repair.effect.length).toBeGreaterThan(0);
    }
  });
});

describe("repair lookups & tone", () => {
  it("finds a known repair and misses an unknown one", () => {
    expect(getRepair("pause_visibility")?.label).toContain("Ghost");
    expect(getRepair("___nope___")).toBeUndefined();
  });

  it("tones risk levels", () => {
    expect(repairRiskTone("high")).toBe("danger");
    expect(repairRiskTone("medium")).toBe("warning");
    expect(repairRiskTone("low")).toBe("default");
  });

  it("groups the whole catalog by category without dropping any repair", () => {
    const grouped = repairsByCategory();
    const total = grouped.reduce((sum, group) => sum + group.repairs.length, 0);
    expect(total).toBe(REPAIR_CATALOG.length);
  });
});

describe("permission-scoped availability", () => {
  it("only surfaces repairs whose permission the actor holds", () => {
    const supportOnly: AdminPermission[] = ["admin.support.manage"];
    const allowed = allowedRepairs(supportOnly).map((r: RepairDefinition) => r.id);
    expect(allowed).toContain("pause_visibility");
    // reset_onboarding needs admin.users.suspend — not held here.
    expect(allowed).not.toContain("reset_onboarding");
  });

  it("an owner (all permissions) can run everything", () => {
    expect(allowedRepairs(ADMIN_PERMISSIONS).length).toBe(REPAIR_CATALOG.length);
  });

  it("no permissions means no repairs", () => {
    expect(allowedRepairs([]).length).toBe(0);
  });
});
