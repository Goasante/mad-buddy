import { describe, expect, it } from "vitest";

import {
  isPwaInlineAdRoute,
  shouldRequestAd,
  type AdFormat
} from "@/lib/ads/policy";

function allowed(pathname = "/dashboard", format: AdFormat = "inline") {
  return shouldRequestAd({
    pathname,
    format,
    adsEnabled: true,
    formatEnabled: true,
    adFree: false,
    configured: true
  });
}

describe("PWA ad policy", () => {
  it("allows the approved Home inline placement for an ad-eligible account", () => {
    expect(allowed()).toBe(true);
    expect(isPwaInlineAdRoute("/dashboard")).toBe(true);
  });

  it("does not silently turn ordinary app pages into inline ad surfaces", () => {
    for (const pathname of ["/friends", "/plans", "/events", "/profile", "/linkr", "/hangout-mode"]) {
      expect(allowed(pathname)).toBe(false);
      expect(isPwaInlineAdRoute(pathname)).toBe(false);
    }
  });

  it.each([
    ["master switch", { adsEnabled: false }],
    ["format switch", { formatEnabled: false }],
    ["Mad Buddy Access", { adFree: true }],
    ["missing provider configuration", { configured: false }]
  ])("fails closed when %s blocks ads", (_name, override) => {
    expect(
      shouldRequestAd({
        pathname: "/dashboard",
        format: "inline",
        adsEnabled: true,
        formatEnabled: true,
        adFree: false,
        configured: true,
        ...override
      })
    ).toBe(false);
  });

  it.each([
    "/login",
    "/signup",
    "/onboarding",
    "/safe-arrival",
    "/safe-arrival/active",
    "/billing",
    "/settings/access",
    "/admin/features",
    "/camera",
    "/messages",
    "/messages/123"
  ])("blocks sensitive/non-monetizable route %s", (pathname) => {
    expect(allowed(pathname)).toBe(false);
  });

  it("keeps not-yet-implemented web formats disabled even if their Admin switch is on", () => {
    expect(allowed("/dashboard", "anchor")).toBe(false);
    expect(allowed("/dashboard", "interstitial")).toBe(false);
  });
});
