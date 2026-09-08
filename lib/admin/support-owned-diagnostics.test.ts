import { describe, expect, it } from "vitest";
import { buildSupportOwnedDiagnostics, type SupportOwnedSnapshot } from "@/lib/admin/support-owned-diagnostics";

function snapshot(overrides: Partial<SupportOwnedSnapshot> = {}): SupportOwnedSnapshot {
  const base: SupportOwnedSnapshot = {
    account: { authUserExists: true, profileExists: true, isOnboarded: true },
    activation: { milestoneCount: 4 },
    profile: { hasAvatar: true, showcasePhotoCount: 2, publicShowcasePhotoCount: 2 },
    dob: { state: "adult", selfServeCorrectionAvailable: true },
    linkr: { enabled: true, hasPublicPhoto: true, ageEligible: true, accountRestricted: false },
    presence: { visibility: "visible", signal: "fresh", staleStatusCount: 0 },
    notifications: { unreadCount: 2, webPushDevices: 1, nativePushDevices: 1, stalePushDevices: 0 },
    features: { activeRateLimitCount: 0 },
    journey: { achievementCount: 3, milestoneCount: 4 }
  };
  return {
    ...base,
    ...overrides,
    account: { ...base.account, ...(overrides.account ?? {}) },
    activation: { ...base.activation, ...(overrides.activation ?? {}) },
    profile: { ...base.profile, ...(overrides.profile ?? {}) },
    dob: { ...base.dob, ...(overrides.dob ?? {}) },
    linkr: { ...base.linkr, ...(overrides.linkr ?? {}) },
    presence: { ...base.presence, ...(overrides.presence ?? {}) },
    notifications: { ...base.notifications, ...(overrides.notifications ?? {}) },
    features: { ...base.features, ...(overrides.features ?? {}) },
    journey: { ...base.journey, ...(overrides.journey ?? {}) }
  };
}

const find = (items: ReturnType<typeof buildSupportOwnedDiagnostics>, id: string) =>
  items.find((item) => item.id === id);

describe("support-owned Account Doctor diagnostics", () => {
  it("treats an under-18 age gate as a product rule rather than a defect", () => {
    const finding = find(buildSupportOwnedDiagnostics(snapshot({ dob: { state: "under_18", selfServeCorrectionAvailable: true } })), "dob-state");
    expect(finding).toMatchObject({ severity: "product_rule", operatorAction: "explain_product_rule" });
    expect(finding?.detail).toContain("must not override");
  });

  it("treats a spent DOB correction as an intentional lock", () => {
    const items = buildSupportOwnedDiagnostics(snapshot({ dob: { state: "adult", selfServeCorrectionAvailable: false } }));
    expect(find(items, "dob-correction-budget")).toMatchObject({
      severity: "product_rule",
      operatorAction: "explain_product_rule"
    });
  });

  it("does not call Linkr being switched off a discovery defect", () => {
    const finding = find(buildSupportOwnedDiagnostics(snapshot({ linkr: { enabled: false, hasPublicPhoto: true, ageEligible: true, accountRestricted: false } })), "linkr-eligibility");
    expect(finding).toMatchObject({ severity: "info", operatorAction: "explain_product_rule" });
  });

  it("never recommends bypassing Linkr's age gate or restriction", () => {
    const underAge = find(
      buildSupportOwnedDiagnostics(snapshot({ linkr: { enabled: true, hasPublicPhoto: true, ageEligible: false, accountRestricted: false } })),
      "linkr-eligibility"
    );
    const restricted = find(
      buildSupportOwnedDiagnostics(snapshot({ linkr: { enabled: true, hasPublicPhoto: true, ageEligible: true, accountRestricted: true } })),
      "linkr-eligibility"
    );
    expect(underAge?.operatorAction).toBe("explain_product_rule");
    expect(restricted?.operatorAction).toBe("explain_product_rule");
    expect(underAge?.repairId).toBeUndefined();
    expect(restricted?.repairId).toBeUndefined();
  });

  it("keeps Ghost Mode privacy above a missing presence signal", () => {
    const finding = find(
      buildSupportOwnedDiagnostics(snapshot({ presence: { visibility: "ghost", signal: "missing", staleStatusCount: 0 } })),
      "presence-signal"
    );
    expect(finding).toMatchObject({ severity: "info", operatorAction: "explain_product_rule" });
    expect(finding?.repairId).toBeUndefined();
  });

  it("never recommends a presence repair, because the loader cannot report stale", () => {
    /* This used to hand-build `signal: "stale"` and assert a repair was
       recommended -- a value the live loader CANNOT produce, because an expired
       location row is not drift and projects as `missing`. The test passed
       while the feature was dead, which is precisely the failure mode worth
       pinning. Only the two reachable states are asserted now. */
    for (const signal of ["fresh", "missing"] as const) {
      const findings = buildSupportOwnedDiagnostics(
        snapshot({ presence: { visibility: "visible", signal, staleStatusCount: 0 } })
      );
      for (const finding of findings) {
        expect(finding.repairId).not.toBe("reset_glow_signal");
      }
    }
  });

  it("reports push registrations without exposing endpoints or tokens, and offers no repair", () => {
    const findings = buildSupportOwnedDiagnostics(snapshot());
    const finding = find(findings, "push-device-freshness");

    expect(finding?.detail ?? "").not.toMatch(/endpoint|p256dh|token/i);
    /* `stalePushDevices` is hard-coded 0 -- there is no canonical stale-token
       rule -- so no push repair may be recommended from here. */
    expect(finding?.repairId).toBeUndefined();
  });

  it("does not automatically clear a legitimate active rate limit", () => {
    const finding = find(
      buildSupportOwnedDiagnostics(snapshot({ features: { activeRateLimitCount: 2 } })),
      "rate-limit-state"
    );
    expect(finding).toMatchObject({ severity: "info", operatorAction: "keep_diagnosing" });
    expect(finding?.repairId).toBeUndefined();
  });

  it("escalates broken auth/profile linkage instead of fabricating identity", () => {
    const finding = find(
      buildSupportOwnedDiagnostics(snapshot({ account: { authUserExists: true, profileExists: false, isOnboarded: false } })),
      "account-linkage"
    );
    expect(finding).toMatchObject({ severity: "issue", operatorAction: "escalate" });
  });

  it("only summarizes achievement evidence and never grants an achievement", () => {
    const finding = find(buildSupportOwnedDiagnostics(snapshot()), "journey-evidence");
    expect(finding).toMatchObject({ severity: "info", operatorAction: "keep_diagnosing" });
    expect(finding?.repairId).toBeUndefined();
  });
});
