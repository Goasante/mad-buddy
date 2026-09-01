import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");

/** Consumer tours no longer compare billing tiers. Historical migration rows may
 * remain for compatibility, but the live registry/service/runner must not turn
 * them into consumer purchase education. */
describe("guided tours do not project retired subscription tiers", () => {
  it("does not resolve per-tier entitlement tables for consumer tours", () => {
    const service = readFileSync(join(ROOT, "lib/tours/service.ts"), "utf8");
    expect(service).not.toContain("entitlementsFor(");
    expect(service).not.toContain("NUMERIC_ENTITLEMENTS");
    expect(service).not.toContain("BOOLEAN_ENTITLEMENTS");
  });

  it("does not render the old tier comparison", () => {
    const runner = readFileSync(join(ROOT, "components/tours/tour-runner.tsx"), "utf8");
    expect(runner).not.toContain("Buddy Plus");
    expect(runner).not.toContain("Buddy Pro");
    expect(runner).not.toContain("stepEntitlements");
  });

  it("keeps historical tour rows non-authoritative by removing the live subscription guide", () => {
    const registry = readFileSync(join(ROOT, "lib/tours/registry.ts"), "utf8");
    expect(registry).not.toContain('slug: "subscription-guide"');
    expect(registry).not.toContain('path: "/upgrade"');
  });
});
