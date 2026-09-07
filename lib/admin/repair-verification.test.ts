import { describe, expect, it } from "vitest";

import {
  blockedByRule,
  fixed,
  isTerminal,
  needsEscalation,
  notApplicable,
  OUTCOME_GUIDANCE,
  OUTCOME_LABEL,
  type RepairOutcome,
  stillBroken,
  verificationTone
} from "@/lib/admin/repair-verification";

/**
 * The contract's job is to stop "the write succeeded" being mistaken for "the
 * user's problem is solved", and to keep a deliberate product refusal from
 * being read as a bug an operator should push past.
 */

const ALL: RepairOutcome[] = ["fixed", "still_broken", "not_applicable", "blocked_by_product_rule"];

describe("the four outcomes are distinct and complete", () => {
  it("every outcome has a label, a tone and operator guidance", () => {
    for (const outcome of ALL) {
      expect(OUTCOME_LABEL[outcome]).toBeTruthy();
      expect(OUTCOME_GUIDANCE[outcome]).toBeTruthy();
      expect(verificationTone(outcome)).toBeTruthy();
    }
  });

  it("no two outcomes share a label", () => {
    const labels = ALL.map((o) => OUTCOME_LABEL[o]);
    expect(new Set(labels).size).toBe(ALL.length);
  });

  it("a product rule does not read as a failure", () => {
    // The whole point: `still_broken` is red, a rule is not.
    expect(verificationTone("still_broken")).toBe("danger");
    expect(verificationTone("blocked_by_product_rule")).not.toBe("danger");
  });
});

describe("what the operator is told to do next", () => {
  it("a repair that ran and left the state wrong is escalated, not retried", () => {
    expect(needsEscalation("still_broken")).toBe(true);
    expect(OUTCOME_GUIDANCE.still_broken).toMatch(/escalate/i);
    expect(OUTCOME_GUIDANCE.still_broken).toMatch(/do not re-run/i);
  });

  it("only a genuine failure is escalated", () => {
    for (const outcome of ALL.filter((o) => o !== "still_broken")) {
      expect(needsEscalation(outcome)).toBe(false);
    }
  });

  it("a rule is explained, never overridden", () => {
    expect(OUTCOME_GUIDANCE.blocked_by_product_rule).toMatch(/not a fault|refusing on purpose/i);
    expect(OUTCOME_GUIDANCE.blocked_by_product_rule).toMatch(/must not override/i);
  });

  it("fixed and blocked both end the interaction; the other two do not", () => {
    expect(isTerminal("fixed")).toBe(true);
    expect(isTerminal("blocked_by_product_rule")).toBe(true);
    expect(isTerminal("still_broken")).toBe(false);
    expect(isTerminal("not_applicable")).toBe(false);
  });

  it("nothing-to-repair sends the operator back to diagnosis rather than to a repair", () => {
    expect(OUTCOME_GUIDANCE.not_applicable).toMatch(/keep diagnosing|different area/i);
  });
});

describe("every verification names the invariant it re-read", () => {
  it("each constructor carries an invariant and a summary", () => {
    const cases = [
      fixed("direct conversation is active and both members joined", "Messaging works again."),
      stillBroken("direct conversation is active", "The conversation is still archived."),
      notApplicable("direct conversation is active", "Nothing was archived."),
      blockedByRule("direct conversation is active", "A live block outranks friendship", "Still blocked.")
    ];
    for (const result of cases) {
      expect(result.invariant.length).toBeGreaterThan(0);
      expect(result.summary.length).toBeGreaterThan(0);
    }
  });

  it("only a rule-blocked verification names a rule", () => {
    expect(blockedByRule("i", "A live block outranks friendship", "s").rule).toBeTruthy();
    expect(fixed("i", "s").rule).toBeUndefined();
    expect(stillBroken("i", "s").rule).toBeUndefined();
    expect(notApplicable("i", "s").rule).toBeUndefined();
  });

  it("the constructors produce the outcome they are named for", () => {
    expect(fixed("i", "s").outcome).toBe("fixed");
    expect(stillBroken("i", "s").outcome).toBe("still_broken");
    expect(notApplicable("i", "s").outcome).toBe("not_applicable");
    expect(blockedByRule("i", "r", "s").outcome).toBe("blocked_by_product_rule");
  });
});
