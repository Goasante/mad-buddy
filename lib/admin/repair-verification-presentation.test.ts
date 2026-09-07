import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("components/admin/repairs/repair-centre.tsx", "utf8");

describe("repair verification presentation", () => {
  it("does not discard the server-side verification object", () => {
    expect(source).toContain("verification: result.verification");
    expect(source).toContain("feedback.verification");
  });

  it("renders the verifier summary because safety qualifiers are part of the result", () => {
    expect(source).toContain("{verification.summary}");
    expect(source).toContain("Verified invariant:");
  });

  it("renders product-rule explanations and the operator next action", () => {
    expect(source).toContain("Product rule:");
    expect(source).toContain("OUTCOME_GUIDANCE[verification.outcome]");
  });

  it("never presents an unverified mutation as confirmed fixed", () => {
    expect(source).toContain("does not yet have an invariant verifier");
    expect(source).toContain("not confirmed fixed");
  });
});
