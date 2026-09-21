import { describe, expect, it } from "vitest";

import { extendContentSecurityPolicyForGoogleAds } from "@/lib/ads/csp";

const base = [
  "default-src 'self'",
  "script-src 'self' 'nonce-test'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-src https://challenges.cloudflare.com",
  "object-src 'none'"
].join("; ");

describe("Google web-ad CSP extension", () => {
  it("does not broaden CSP when AdSense is not configured", () => {
    expect(extendContentSecurityPolicyForGoogleAds(base, false)).toBe(base);
  });

  it("adds the ad script only to script-src", () => {
    const policy = extendContentSecurityPolicyForGoogleAds(base, true);
    expect(policy).toContain("script-src 'self' 'nonce-test' https://pagead2.googlesyndication.com");
    expect(policy).not.toContain("default-src 'self' https://pagead2.googlesyndication.com");
  });

  it("adds Google ad network sources to image, connect and frame directives", () => {
    const policy = extendContentSecurityPolicyForGoogleAds(base, true);
    for (const directive of ["img-src", "connect-src", "frame-src"]) {
      const line = policy.split("; ").find((part) => part.startsWith(`${directive} `));
      expect(line).toContain("https://*.googlesyndication.com");
      expect(line).toContain("https://*.doubleclick.net");
      expect(line).toContain("https://*.google.com");
      expect(line).toContain("https://www.google.com");
    }
  });
});
