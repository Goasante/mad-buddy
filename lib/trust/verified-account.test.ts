import { describe, expect, it } from "vitest";

import { hasVerifiedAccountStatus } from "@/lib/trust/verified-account";

describe("verified account status", () => {
  it("returns true when any verification row is verified", () => {
    expect(hasVerifiedAccountStatus([
      { status: "pending" },
      { status: "verified" },
      { status: "failed" }
    ])).toBe(true);
  });

  it("returns false for pending, failed, expired and revoked rows", () => {
    expect(hasVerifiedAccountStatus([{ status: "pending" }])).toBe(false);
    expect(hasVerifiedAccountStatus([{ status: "failed" }])).toBe(false);
    expect(hasVerifiedAccountStatus([{ status: "expired" }])).toBe(false);
    expect(hasVerifiedAccountStatus([{ status: "revoked" }])).toBe(false);
  });
});
