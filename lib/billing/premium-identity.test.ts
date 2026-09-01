import { describe, expect, it } from "vitest";
import { membershipTierLabel, premiumBadgeIdentity, publicMembershipTier } from "@/lib/billing/premium-identity";

describe("retired consumer tier identity", () => {
  it("never exposes Plus/Pro as social status", () => {
    for (const plan of ["free", "buddy_plus", "buddy_pro"] as const) {
      expect(premiumBadgeIdentity(plan)).toBeNull();
      expect(publicMembershipTier(plan)).toBe("free");
    }
    expect(membershipTierLabel("plus")).toBeNull();
    expect(membershipTierLabel("pro")).toBeNull();
  });
});
