import { describe, expect, it } from "vitest";
import { authErrorRedirect, oauthErrorMessage, safeAuthNext } from "@/lib/auth/oauth-redirect";

describe("OAuth redirects", () => {
  it("keeps local destinations", () => {
    expect(safeAuthNext("/dashboard")).toBe("/dashboard");
    expect(safeAuthNext("/onboarding?step=profile")).toBe("/onboarding?step=profile");
  });

  it("rejects external and protocol-relative destinations", () => {
    expect(safeAuthNext("https://example.com")).toBe("/dashboard");
    expect(safeAuthNext("//example.com")).toBe("/dashboard");
    expect(safeAuthNext("/\\example.com")).toBe("/dashboard");
  });

  it("returns friendly known errors without reflecting unknown input", () => {
    expect(oauthErrorMessage("cancelled")).toContain("cancelled");
    expect(oauthErrorMessage("untrusted provider message")).toBeNull();
  });

  it("builds a local error redirect", () => {
    expect(authErrorRedirect("https://madbuddy.example", "/login", "callback_failed").toString()).toBe(
      "https://madbuddy.example/login?oauth_error=callback_failed"
    );
  });
});
