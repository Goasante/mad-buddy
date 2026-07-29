import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BOOLEAN_ENTITLEMENTS, NUMERIC_ENTITLEMENTS } from "@/lib/billing/entitlement-catalog";

const ROOT = join(__dirname, "..", "..");

/**
 * The tour must never state a plan capability that the real subscription system
 * does not back (brief §13/§14/§27). Two ways that can go wrong, both guarded:
 *  1. a seeded step references an entitlement key that does not exist;
 *  2. the tour keeps its own copy of what a plan includes.
 */
describe("guided tour plan claims come from the canonical entitlement catalog", () => {
  const migration = readFileSync(
    join(ROOT, "supabase/migrations/20260729120000_guided_product_tours.sql"),
    "utf8"
  );
  const knownKeys = new Set<string>([
    ...NUMERIC_ENTITLEMENTS.map((entry) => entry.key as string),
    ...BOOLEAN_ENTITLEMENTS.map((entry) => entry.key as string)
  ]);

  it("every entitlement key seeded into a tour step really exists", () => {
    // Pull each '{a,b,c}'::text[] literal out of the seed and flatten it.
    const referenced = [...migration.matchAll(/'\{([a-z_,\s]*)\}'::text\[\]/g)]
      .flatMap((match) => match[1].split(","))
      .map((key) => key.trim())
      .filter((key) => key.length > 0);

    // Sanity: the seed really does reference some entitlements, so this test
    // cannot silently pass by matching nothing.
    expect(referenced.length).toBeGreaterThan(0);

    const unknown = [...new Set(referenced)].filter((key) => !knownKeys.has(key));
    expect(unknown).toEqual([]);
  });

  it("resolves plan values from entitlementsFor rather than hardcoding them", () => {
    const service = readFileSync(join(ROOT, "lib/tours/service.ts"), "utf8");
    // Admin tier overrides are merged inside entitlementsFor(), so anything
    // that bypasses it can report a stale or wrong limit.
    expect(service).toContain("entitlementsFor(");
    expect(service).toContain("NUMERIC_ENTITLEMENTS");
    expect(service).toContain("BOOLEAN_ENTITLEMENTS");
  });

  it("treats Infinity and null as unlimited, not as a number", () => {
    // The repo convention is Infinity internally and null after JSON. Rendering
    // either as a figure would understate a plan.
    const service = readFileSync(join(ROOT, "lib/tours/service.ts"), "utf8");
    expect(service).toContain("Number.isFinite");
    expect(service).toMatch(/value === null/);
  });
});
