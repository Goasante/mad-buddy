import { describe, expect, it } from "vitest";
import { authErrorRedirect, oauthErrorMessage, safeAuthNext } from "@/lib/auth/oauth-redirect";
import { POST_LOGIN_ROUTE } from "@/lib/routes";

describe("OAuth redirects", () => {
  it("keeps local destinations", () => {
    expect(safeAuthNext("/dashboard")).toBe("/dashboard");
    expect(safeAuthNext("/onboarding?step=profile")).toBe("/onboarding?step=profile");
    expect(safeAuthNext("/messages?conversation=abc#latest")).toBe("/messages?conversation=abc#latest");
  });

  it("rejects external and protocol-relative destinations", () => {
    expect(safeAuthNext("https://example.com")).toBe(POST_LOGIN_ROUTE);
    expect(safeAuthNext("//example.com")).toBe(POST_LOGIN_ROUTE);
    expect(safeAuthNext("/\\example.com")).toBe(POST_LOGIN_ROUTE);
    expect(safeAuthNext("/login?next=%2Fmessages")).toBe(POST_LOGIN_ROUTE);
    expect(safeAuthNext("/auth/callback")).toBe(POST_LOGIN_ROUTE);
    expect(safeAuthNext("/route-that-does-not-exist")).toBe(POST_LOGIN_ROUTE);
    expect(safeAuthNext("/messages?access_token=secret")).toBe(POST_LOGIN_ROUTE);
    expect(safeAuthNext("/messages#refresh_token=secret")).toBe(POST_LOGIN_ROUTE);
    expect(safeAuthNext("/messages\u0000")).toBe(POST_LOGIN_ROUTE);
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

  it("preserves a safe destination when OAuth returns an error", () => {
    expect(
      authErrorRedirect(
        "https://madbuddy.example",
        "/login",
        "callback_failed",
        "/messages?conversation=abc"
      ).toString()
    ).toBe(
      "https://madbuddy.example/login?oauth_error=callback_failed&next=%2Fmessages%3Fconversation%3Dabc"
    );
  });
});
