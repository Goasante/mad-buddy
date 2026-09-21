import { describe, expect, it } from "vitest";

import { shouldRequestAd, type AdFormat } from "@/lib/ads/policy";

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
  it("allows an ordinary Home inline placement for an ad-eligible account", () => {
    expect(allowed()).toBe(true);
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
    "/camera"
  ])("blocks sensitive route %s", (pathname) => {
    expect(allowed(pathname)).toBe(false);
  });

  it("keeps the Messages list eligible but blocks an active conversation", () => {
    expect(allowed("/messages")).toBe(true);
    expect(allowed("/messages/123")).toBe(false);
  });

  it("never allows an interstitial inside messaging", () => {
    expect(allowed("/messages", "interstitial")).toBe(false);
  });
});
