import { describe, expect, it } from "vitest";
import {
  authenticatedRedirect,
  isApiPath,
  isPublicPath,
  requiredLoginRedirect
} from "@/lib/security/route-protection";

describe("authenticated visitors on guest-only routes", () => {
  it("sends a signed-in user from the landing and auth forms to the dashboard", () => {
    for (const path of ["/", "/login", "/signup", "/forgot-password"]) {
      expect(authenticatedRedirect(path)).toBe("/dashboard");
    }
  });

  it("never redirects /reset-password — the recovery link signs the user in first", () => {
    // Redirecting here would make it impossible to ever set a new password.
    expect(authenticatedRedirect("/reset-password")).toBeNull();
  });

  it("leaves the OAuth callback and admin login alone", () => {
    expect(authenticatedRedirect("/auth/callback")).toBeNull();
    expect(authenticatedRedirect("/admin/login")).toBeNull();
  });

  it("keeps marketing and legal pages readable while signed in", () => {
    for (const path of ["/pricing", "/about", "/faq", "/privacy", "/terms"]) {
      expect(authenticatedRedirect(path)).toBeNull();
    }
  });

  it("does not touch in-app routes or API paths", () => {
    for (const path of ["/dashboard", "/plans", "/messages", "/api/notifications"]) {
      expect(authenticatedRedirect(path)).toBeNull();
    }
  });

  it("does not prefix-match beyond a path boundary", () => {
    expect(authenticatedRedirect("/loginsomething")).toBeNull();
    expect(authenticatedRedirect("/signup-flow")).toBeNull();
  });
});

describe("route protection (deny-by-default, audit I-08)", () => {
  it("treats the documented public pages as public", () => {
    for (const path of [
      "/",
      "/pricing",
      "/about",
      "/faq",
      "/privacy",
      "/terms",
      "/login",
      "/signup",
      "/forgot-password",
      "/reset-password",
      "/auth/callback",
      "/admin/login",
      "/subscription-success",
      "/subscription-cancelled",
      "/robots.txt",
      "/sitemap.xml"
    ]) {
      expect(requiredLoginRedirect(path), path).toBeNull();
    }
  });

  it("protects every known private route", () => {
    for (const path of [
      "/dashboard",
      "/friends",
      "/friends/some_username",
      "/plans",
      "/messages",
      "/events",
      "/groups/legon-entrepreneurs",
      "/settings/appearance",
      "/billing",
      "/onboarding"
    ]) {
      expect(requiredLoginRedirect(path), path).toBe("/login");
    }
  });

  it("makes an invite landing public but keeps the authed invite screen private", () => {
    // A logged-out recipient must be able to open an invite link (spec §21).
    expect(requiredLoginRedirect("/invite/abc123token")).toBeNull();
    expect(isPublicPath("/invite/abc123token")).toBe(true);

    // ...but /invite itself is the authenticated "Invite a Muddy" screen. A
    // plain prefix rule would wrongly expose it, so this must stay protected.
    expect(requiredLoginRedirect("/invite")).toBe("/login");
    expect(isPublicPath("/invite")).toBe(false);
    // A trailing slash with no token is not a landing page either.
    expect(isPublicPath("/invite/")).toBe(false);
  });

  it("protects routes that do not exist yet, the deny-by-default guarantee", () => {
    // This is the regression the old allowlist model shipped once (/plans).
    expect(requiredLoginRedirect("/some-feature-added-next-sprint")).toBe("/login");
    expect(requiredLoginRedirect("/x")).toBe("/login");
  });

  it("sends admin paths to the admin login, except the login page itself", () => {
    expect(requiredLoginRedirect("/admin")).toBe("/admin/login");
    expect(requiredLoginRedirect("/admin/users")).toBe("/admin/login");
    expect(requiredLoginRedirect("/admin/login")).toBeNull();
  });

  it("does not prefix-match beyond a path boundary", () => {
    // "/pricingx" must NOT inherit "/pricing"'s public status.
    expect(isPublicPath("/pricingx")).toBe(false);
    expect(requiredLoginRedirect("/pricingx")).toBe("/login");
    // "/administrator" is not under "/admin" either, but is still private.
    expect(requiredLoginRedirect("/administrator")).toBe("/login");
  });

  it("passes API routes through so they can return 401 JSON themselves", () => {
    expect(isApiPath("/api/friends/nearby")).toBe(true);
    expect(requiredLoginRedirect("/api/friends/nearby")).toBeNull();
    expect(requiredLoginRedirect("/api/paystack/webhook")).toBeNull();
  });
});
