import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const exists = (p: string) => existsSync(join(process.cwd(), p));

/**
 * Admin must be able to grant the product that actually exists.
 *
 * The reported defect: giving a new user subscription privilege offered only
 * "Buddy Plus" and "Buddy Pro". Those belong to the premium-trial system, which
 * the access resolver does not read at all -- so the grant appeared to work and
 * changed nothing. The real actions had been correct and audited since the
 * access model shipped, but nothing rendered them, so there was no screen to
 * find.
 */

describe("Mad Buddy Access has an admin screen", () => {
  it("renders the page", () => {
    expect(exists("app/(admin)/admin/access/page.tsx")).toBe(true);
  });

  it("wires the real access actions rather than the trial ones", () => {
    const controls = read("components/admin/access/access-controls.tsx");
    expect(controls).toContain("grantAccessAction");
    expect(controls).toContain("revokeAccessAction");
    expect(controls).toContain("openGlobalAccessAction");
    expect(controls).toContain("closeGlobalAccessAction");
  });

  it("offers no legacy tier anywhere in the access admin", () => {
    const controls = read("components/admin/access/access-controls.tsx");
    const page = read("app/(admin)/admin/access/page.tsx");
    expect(`${controls}${page}`).not.toMatch(/buddy_plus|buddy_pro|Buddy Plus|Buddy Pro/);
  });

  it("is reachable from the admin navigation", () => {
    const shell = read("components/admin/admin-shell.tsx");
    expect(shell).toContain('"/admin/access"');
    expect(shell).toContain("Mad Buddy Access");
  });

  it("is gated on the existing entitlements permission", () => {
    // No new permission was invented for this; the role matrix is unchanged.
    expect(read("app/(admin)/admin/access/page.tsx")).toContain('requireAdminPagePermission("admin.entitlements.manage")');
  });
});

describe("the misleading trial surface is gone", () => {
  it("removes the premium trials admin page", () => {
    expect(exists("app/(admin)/admin/revenue/trials/page.tsx")).toBe(false);
    expect(exists("app/(admin)/admin/revenue/trials/actions.ts")).toBe(false);
    expect(exists("components/admin/revenue/trial-controls.tsx")).toBe(false);
  });

  it("removes the link that led there", () => {
    expect(read("app/(admin)/admin/revenue/page.tsx")).not.toContain("/admin/revenue/trials");
  });
});

describe("what the revoke button claims is what it does", () => {
  it("says it only removes admin grants", () => {
    const controls = read("components/admin/access/access-controls.tsx");

    // Revoking a grant does not cancel a subscription, end Welcome Access or
    // remove staff access. An admin who assumes otherwise reads a working
    // revoke as a broken one.
    expect(controls).toMatch(/Revokes admin grants only/i);
  });

  it("explains that a global window restores everyone to their own sources", () => {
    expect(read("components/admin/access/access-controls.tsx")).toMatch(/restores each person to their own sources|returns everybody to whatever they hold on their own/i);
  });
});
