import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const shell = readFileSync("components/admin/admin-shell.tsx", "utf8");
const repairCentre = readFileSync("components/admin/repairs/repair-centre.tsx", "utf8");

describe("admin operator identity affordances", () => {
  it("keeps the legacy Entitlements route available but hides it from navigation", () => {
    const route = shell.slice(shell.indexOf('href: "/admin/entitlements"'), shell.indexOf('href: "/admin/analytics"'));

    expect(route).toContain('href: "/admin/entitlements"');
    expect(route).toContain('label: "Entitlements"');
    expect(route).toContain("hidden: true");
    expect(shell).toContain("!item.hidden");
  });

  it("shows the selected account user ID and provides an explicit copy action", () => {
    expect(repairCentre).toContain("{selected.userId}");
    expect(repairCentre).toContain("navigator.clipboard.writeText(selected.userId)");
    expect(repairCentre).toContain('"Copy user ID"');
    expect(repairCentre).toContain('"User ID copied"');
  });
});
