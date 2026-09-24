import { describe, expect, it } from "vitest";

import { VERIFICATION_MIN_ACCOUNT_AGE_DAYS, verificationApplicationEligibility } from "./verification-application-model";

const joined = "2026-01-01T12:00:00.000Z";
const joinedMs = Date.parse(joined);
const eligibleMs = joinedMs + 30 * 24 * 60 * 60 * 1000;

describe("verification application eligibility", () => {
  it("requires 30 full days before applying", () => {
    expect(VERIFICATION_MIN_ACCOUNT_AGE_DAYS).toBe(30);
    expect(verificationApplicationEligibility({ createdAt: joined, profilePhotoUrl: "photo.jpg", nowMs: eligibleMs - 1 })).toContain("after 30 days");
    expect(verificationApplicationEligibility({ createdAt: joined, profilePhotoUrl: "photo.jpg", nowMs: eligibleMs })).toBeNull();
  });

  it("requires a profile photo and rejects an unparseable join date", () => {
    expect(verificationApplicationEligibility({ createdAt: joined, profilePhotoUrl: null, nowMs: eligibleMs })).toContain("photo of your face");
    expect(verificationApplicationEligibility({ createdAt: "invalid", profilePhotoUrl: "photo.jpg", nowMs: eligibleMs })).toContain("could not be confirmed");
  });
});
