import { describe, expect, it } from "vitest";

import { adEntitlementFromAccess } from "@/lib/access/ad-entitlement";
import type { AccessState, AccessSource } from "@/lib/access/resolver";

function state(input: Partial<AccessState> = {}): AccessState {
  return {
    hasAccess: false,
    primarySource: null,
    sources: [],
    expiresAt: null,
    daysRemaining: null,
    isWelcomeAccess: false,
    isPaid: false,
    isAdminGrant: false,
    isGlobalOverride: false,
    isStaff: false,
    ...input
  };
}

function active(source: AccessSource, input: Partial<AccessState> = {}): AccessState {
  return state({
    hasAccess: true,
    primarySource: source,
    sources: [{ source, startsAt: "2026-09-01T00:00:00.000Z", expiresAt: "2026-10-01T00:00:00.000Z" }],
    expiresAt: "2026-10-01T00:00:00.000Z",
    daysRemaining: 10,
    ...input
  });
}

describe("ads-first entitlement projection", () => {
  it("shows ads when there is no active Mad Buddy Access source", () => {
    expect(adEntitlementFromAccess(state())).toEqual({
      adFree: false,
      hasAccess: false,
      primarySource: null,
      expiresAt: null,
      daysRemaining: null
    });
  });

  it.each([
    ["welcome_access", { isWelcomeAccess: true }],
    ["web_subscription", { isPaid: true }],
    ["apple_subscription", { isPaid: true }],
    ["google_subscription", { isPaid: true }],
    ["admin_grant", { isAdminGrant: true }],
    ["global_promo", { isGlobalOverride: true }],
    ["staff", { isStaff: true, expiresAt: null, daysRemaining: null }]
  ] as const)("treats %s as ad-free", (source, extras) => {
    const projection = adEntitlementFromAccess(active(source, extras));
    expect(projection.adFree).toBe(true);
    expect(projection.hasAccess).toBe(true);
    expect(projection.primarySource).toBe(source);
  });

  it("does not invent a separate advertising expiry", () => {
    const projection = adEntitlementFromAccess(
      active("admin_grant", {
        expiresAt: "2026-09-30T12:00:00.000Z",
        daysRemaining: 9,
        isAdminGrant: true
      })
    );
    expect(projection.expiresAt).toBe("2026-09-30T12:00:00.000Z");
    expect(projection.daysRemaining).toBe(9);
  });
});
