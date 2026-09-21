import { describe, expect, it } from "vitest";

import { extendContentSecurityPolicyForGoogleAds } from "@/lib/ads/csp";

const base = [
  "default-src 'self'",
  "script-src 'self' 'nonce-test' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-src https://challenges.cloudflare.com",
  "object-src 'none'"
].join("; ");

describe("Google web-ad CSP extension", () => {
  it("does not broaden CSP when AdSense is not configured for the route", () => {
    expect(extendContentSecurityPolicyForGoogleAds(base, false)).toBe(base);
  });

  it("uses Google's nonce-based strict-dynamic script posture", () => {
    const policy = extendContentSecurityPolicyForGoogleAds(base, true);
    const script = policy.split("; ").find((part) => part.startsWith("script-src ")) ?? "";
    expect(script).toContain("'nonce-test'");
    expect(script).toContain("'unsafe-eval'");
    expect(script).toContain("'strict-dynamic'");
    expect(script).toContain("https:");
    expect(script).toContain("http:");
  });

  it("allows changing HTTPS ad-resource origins only on the expanded policy", () => {
    const policy = extendContentSecurityPolicyForGoogleAds(base, true);
    for (const directive of ["img-src", "connect-src", "frame-src"]) {
      const line = policy.split("; ").find((part) => part.startsWith(`${directive} `));
      expect(line).toContain("https:");
    }
    expect(extendContentSecurityPolicyForGoogleAds(base, false)).not.toContain("connect-src 'self' https:");
  });
});
