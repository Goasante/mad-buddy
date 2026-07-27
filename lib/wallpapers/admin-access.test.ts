import { describe, expect, it } from "vitest";
import {
  ADMIN_PERMISSIONS,
  permissionsForRole,
  actorHasPermission,
  type AdminAssignment
} from "@/lib/admin/governance";

const NOW = Date.UTC(2026, 6, 28);

function assignment(role: AdminAssignment["role"]): AdminAssignment {
  return { role, status: "active", startsAtMs: NOW - 1000, expiresAtMs: null };
}

describe("wallpaper admin permission", () => {
  it("exists in the granular permission set", () => {
    expect(ADMIN_PERMISSIONS as readonly string[]).toContain("admin.wallpapers.manage");
  });

  it("is held by the super administrator only, not support/billing roles", () => {
    expect(permissionsForRole("super_administrator")).toContain("admin.wallpapers.manage");
    expect(permissionsForRole("customer_support_agent")).not.toContain("admin.wallpapers.manage");
    expect(permissionsForRole("billing_support_agent")).not.toContain("admin.wallpapers.manage");
  });

  it("gates actorHasPermission by active assignment", () => {
    expect(
      actorHasPermission({ assignments: [assignment("super_administrator")], permission: "admin.wallpapers.manage", nowMs: NOW })
    ).toBe(true);
    expect(
      actorHasPermission({ assignments: [assignment("customer_support_agent")], permission: "admin.wallpapers.manage", nowMs: NOW })
    ).toBe(false);
    // An expired super-admin grant confers nothing.
    expect(
      actorHasPermission({
        assignments: [{ role: "super_administrator", status: "active", startsAtMs: NOW - 5000, expiresAtMs: NOW - 1000 }],
        permission: "admin.wallpapers.manage",
        nowMs: NOW
      })
    ).toBe(false);
  });
});
