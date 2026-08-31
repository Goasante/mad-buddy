import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { requiredLoginRedirect } from "@/lib/security/route-protection";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("Front Door safety route ownership", () => {
  const publicSafety = read("app/safety/page.tsx");
  const linkr = read("components/linkr/linkr-page.tsx");
  const safetyCenter = read("app/(app)/safety-center/page.tsx");
  const adminShell = read("components/admin/admin-shell.tsx");
  const adminReports = read("app/(admin)/admin/reports/page.tsx");

  it("makes /safety a public trust page rather than an admin redirect", () => {
    expect(requiredLoginRedirect("/safety")).toBeNull();
    expect(publicSafety).toContain("PublicPageShell");
    expect(publicSafety).not.toContain("/admin/reports");
    expect(publicSafety).not.toContain("redirect(");
  });

  it("keeps authenticated user safety on /safety-center", () => {
    expect(requiredLoginRedirect("/safety-center")).toBe("/login");
    expect(safetyCenter).toContain("SafetyCenterPage");
    expect(linkr).toContain("/safety-center?report=");
    expect(linkr).not.toContain("/safety?report=");
  });

  it("keeps moderation entry on the protected admin route", () => {
    expect(requiredLoginRedirect("/admin/reports")).toBe("/admin/login");
    expect(adminShell).toContain('{ href: "/admin/reports", label: "Reports"');
    expect(adminReports).toContain('"admin.reports.review"');
    expect(adminReports).toContain('redirect("/admin/login")');
  });
});

describe("Front Door canonical shell convergence", () => {
  const landing = read("components/landing/landing-page.tsx");
  const landingNavigation = read("components/landing/landing-nav.tsx");
  const publicShell = read("components/front-door/public-shell.tsx");

  it("uses the canonical public footer without replacing the landing menu island", () => {
    expect(landing).toContain("<PublicFooter />");
    expect(landing).not.toContain("function Footer()");
    expect(landingNavigation).toContain("<LandingMobileMenu />");
    expect(landingNavigation).toContain("<PublicHeader mobileMenu={<LandingMobileMenu />} />");
    expect(publicShell).toContain("PublicMobileMenu");
  });

  it("sends acquisition CTAs to signup while preserving login actions", () => {
    expect((landing.match(/href="\/signup"/g) ?? [])).toHaveLength(2);
    expect(publicShell).toContain('href="/signup"');
    expect(publicShell).toContain('href="/login"');
  });
});
