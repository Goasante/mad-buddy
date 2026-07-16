import { describe, expect, it } from "vitest";
import { isApiPath, isPublicPath, requiredLoginRedirect } from "@/lib/security/route-protection";

describe("route protection (deny-by-default, audit I-08)", () => {
  it("treats the documented public pages as public", () => {
    for (const path of [
      "/",
      "/pricing",
      "/about",
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

  it("protects routes that do not exist yet — the deny-by-default guarantee", () => {
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
    // "/administrator" is not under "/admin" either — but is still private.
    expect(requiredLoginRedirect("/administrator")).toBe("/login");
  });

  it("passes API routes through so they can return 401 JSON themselves", () => {
    expect(isApiPath("/api/friends/nearby")).toBe(true);
    expect(requiredLoginRedirect("/api/friends/nearby")).toBeNull();
    expect(requiredLoginRedirect("/api/paystack/webhook")).toBeNull();
  });
});
