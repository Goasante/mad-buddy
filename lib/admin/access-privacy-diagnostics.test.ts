import { describe, expect, it } from "vitest";

import {
  type AccessView,
  explainAccess,
  explainPrivacyOperation,
  findAccessReconciliationIssues,
  findStalledPrivacyOperations,
  type PrivacyOperationView,
  verifyExportRetry
} from "@/lib/admin/access-privacy-diagnostics";

/**
 * The failure mode in these two areas is not a missed repair. It is Admin
 * granting paid access as a favour, charging somebody twice for time they
 * already own, or reversing a deletion it cannot prove the state of.
 */

const NOW = new Date("2026-09-07T12:00:00Z");

const access = (overrides: Partial<AccessView> = {}): AccessView => ({
  hasAccess: false,
  activeSource: null,
  expiresAt: null,
  subscriptionStatus: null,
  paidPeriodEndsAt: null,
  welcomeGrantExists: false,
  welcomeGrantExpired: false,
  ...overrides
});

const operation = (overrides: Partial<PrivacyOperationView> = {}): PrivacyOperationView => ({
  operationId: "op-1",
  kind: "export",
  status: "queued",
  ageHours: 2,
  slaHours: 48,
  ...overrides
});

describe("Admin never grants paid access", () => {
  it("no entitlement is a product rule, not a fault to repair", () => {
    const result = explainAccess(access(), NOW);

    expect(result.outcome).toBe("blocked_by_product_rule");
    expect(result.summary).toMatch(/must not grant that outside the normal purchase path/i);
  });

  it("a failed payment is the user's to fix, not Admin's to bridge", () => {
    for (const subscriptionStatus of ["past_due", "unpaid"] as const) {
      const result = explainAccess(access({ subscriptionStatus }), NOW);
      expect(result.outcome).toBe("blocked_by_product_rule");
      expect(result.summary).toMatch(/must not grant access to bridge it/i);
    }
  });

  it("a spent Welcome window is never reissued or extended", () => {
    const result = explainAccess(access({ welcomeGrantExists: true, welcomeGrantExpired: true }), NOW);

    expect(result.outcome).toBe("blocked_by_product_rule");
    expect(result.rule).toMatch(/one-time window/i);
    expect(result.summary).toMatch(/must not extend it/i);
  });
});

describe("a cancelled subscription inside its paid period is correct", () => {
  it("is reported as fine, not as a billing error", () => {
    /* Getting this wrong charges somebody twice for time they already own. */
    const result = explainAccess(
      access({
        hasAccess: true,
        subscriptionStatus: "cancelled",
        paidPeriodEndsAt: "2026-09-30T00:00:00Z"
      }),
      NOW
    );

    expect(result.outcome).toBe("fixed");
    expect(result.summary).toMatch(/not a billing error/i);
    expect(result.summary).toMatch(/lapse on its own/i);
  });

  it("non_renewing is treated the same as cancelled-but-paid", () => {
    /* `non_renewing` is what the resolver actually reads for "renewal off,
       still inside the paid period". Collapsing it into `cancelled` would tell
       somebody to pay again for time they already own. */
    const result = explainAccess(
      access({
        hasAccess: true,
        subscriptionStatus: "non_renewing",
        paidPeriodEndsAt: "2026-09-30T00:00:00Z"
      }),
      NOW
    );

    expect(result.outcome).toBe("fixed");
    expect(result.summary).toMatch(/not a billing error/i);
  });

  it("but once the paid period is over, resubscribing is theirs to do", () => {
    const result = explainAccess(access({ subscriptionStatus: "cancelled" }), NOW);

    expect(result.outcome).toBe("blocked_by_product_rule");
    expect(result.summary).toMatch(/theirs to do/i);
  });
});

describe("paid but not resolving is the one real fault", () => {
  it("is escalated rather than repaired by hand", () => {
    const result = explainAccess(
      access({ subscriptionStatus: "active", paidPeriodEndsAt: "2026-09-30T00:00:00Z" }),
      NOW
    );

    expect(result.outcome).toBe("still_broken");
    expect(result.summary).toMatch(/escalate it rather than granting access by hand/i);
  });

  it("counts a trial the same way", () => {
    expect(
      explainAccess(access({ subscriptionStatus: "trialing", paidPeriodEndsAt: "2026-10-01T00:00:00Z" }), NOW).outcome
    ).toBe("still_broken");
  });

  it("is surfaced as a finding that is explicitly NOT repairable", () => {
    const found = findAccessReconciliationIssues(
      access({ subscriptionStatus: "active", paidPeriodEndsAt: "2026-09-30T00:00:00Z" }),
      NOW
    );

    expect(found).toHaveLength(1);
    expect(found[0].repairable).toBe(false);
    expect(found[0].explanation).toMatch(/not a manual grant/i);
  });

  it("is not raised when access is already working", () => {
    expect(
      findAccessReconciliationIssues(
        access({ hasAccess: true, subscriptionStatus: "active", paidPeriodEndsAt: "2026-09-30T00:00:00Z" }),
        NOW
      )
    ).toEqual([]);
  });

  it("is not raised for a lapsed subscription", () => {
    expect(
      findAccessReconciliationIssues(
        access({ subscriptionStatus: "active", paidPeriodEndsAt: "2026-09-01T00:00:00Z" }),
        NOW
      )
    ).toEqual([]);
  });
});

describe("having access is explained honestly", () => {
  it("a Welcome window says it will end", () => {
    const result = explainAccess(access({ hasAccess: true, activeSource: "welcome_access" }), NOW);

    expect(result.outcome).toBe("fixed");
    expect(result.summary).toMatch(/expected rather than a fault/i);
  });

  it("an ordinary entitlement is simply valid", () => {
    expect(explainAccess(access({ hasAccess: true, activeSource: "web_subscription" }), NOW).outcome).toBe("fixed");
  });
});

describe("slow is not stuck", () => {
  it("an export inside its turnaround is not a finding", () => {
    expect(findStalledPrivacyOperations([operation({ ageHours: 12, slaHours: 48 })])).toEqual([]);
  });

  it("and is explained as progressing normally", () => {
    const result = explainPrivacyOperation(operation({ ageHours: 12, slaHours: 48 }));

    expect(result.outcome).toBe("fixed");
    expect(result.summary).toMatch(/progressing normally, not stuck/i);
  });

  it("an export past its turnaround IS a finding, and is retryable", () => {
    const found = findStalledPrivacyOperations([operation({ ageHours: 72, slaHours: 48 })]);

    expect(found).toHaveLength(1);
    expect(found[0].repairable).toBe(true);
  });

  it("a failed export is a finding whatever its age", () => {
    expect(findStalledPrivacyOperations([operation({ status: "failed", ageHours: 1 })])).toHaveLength(1);
  });

  it("completed and cancelled work is never a finding", () => {
    for (const status of ["completed", "cancelled"] as const) {
      expect(findStalledPrivacyOperations([operation({ status, ageHours: 999 })])).toEqual([]);
    }
  });
});

describe("a deletion is never reversed or blindly re-run from Admin", () => {
  it("a stalled deletion is reported but NOT repairable", () => {
    const found = findStalledPrivacyOperations([
      operation({ kind: "deletion", status: "running", ageHours: 96, slaHours: 48 })
    ]);

    expect(found).toHaveLength(1);
    expect(found[0].repairable).toBe(false);
    expect(found[0].explanation).toMatch(/cannot be safely re-run/i);
  });

  it("a deletion in progress is not undone, even on request", () => {
    const result = explainPrivacyOperation(operation({ kind: "deletion", status: "running", ageHours: 2 }));

    expect(result.outcome).toBe("blocked_by_product_rule");
    expect(result.summary).toMatch(/cannot be undone here/i);
    expect(result.summary).toMatch(/new account/i);
  });

  it("a failed deletion is still not repairable", () => {
    const found = findStalledPrivacyOperations([operation({ kind: "deletion", status: "failed", ageHours: 1 })]);

    expect(found[0].repairable).toBe(false);
  });

  it("a completed deletion is simply done", () => {
    expect(explainPrivacyOperation(operation({ kind: "deletion", status: "completed" })).outcome).toBe(
      "not_applicable"
    );
  });
});

describe("the export retry verifier claims only the retry", () => {
  it("says no account data was changed", () => {
    const result = verifyExportRetry({ attempted: 1, stillFailed: 0 });

    expect(result.outcome).toBe("fixed");
    expect(result.summary).toMatch(/no account data was changed/i);
  });

  it("reports still broken when a retry does not take", () => {
    expect(verifyExportRetry({ attempted: 2, stillFailed: 1 }).outcome).toBe("still_broken");
  });

  it("reports nothing-to-do rather than success", () => {
    expect(verifyExportRetry({ attempted: 0, stillFailed: 0 }).outcome).toBe("not_applicable");
  });
});
