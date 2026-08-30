import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const hub = read("components/dashboard/home-settings-sheet.tsx");
const settings = read("components/settings/settings-page.tsx");

describe("A1 account hub information architecture", () => {
  it("uses the identity header as the one profile entry", () => {
    expect(hub).toContain('href="/profile"');
    expect(hub).toContain("View profile");
    expect(hub).not.toContain("View My Profile");
    expect(hub).not.toContain('label: "My Profile"');
  });

  it("routes the current access model to Mad Buddy Access, never billing", () => {
    expect(hub).toContain('{ href: "/settings/access", label: "Mad Buddy Access"');
    expect(hub).not.toContain('href: "/billing"');
    expect(hub).not.toContain('label: "Membership"');
    expect(settings).toContain('title="Mad Buddy Access"');
    expect(settings).toContain('href="/settings/access"');
    expect(settings).not.toContain('<SettingsSection title="Membership">');
  });

  it("keeps Progress product-facing without renaming Buddy Score internals", () => {
    expect(hub).toContain('{ href: "/buddy-score", label: "Progress"');
    expect(settings).toContain('title="Buddy Score"');
  });

  it("names the visibility destination for what it actually controls", () => {
    expect(hub).toContain('{ href: "/settings/glow-visibility", label: "Glow & Visibility"');
    expect(hub).not.toContain("Location & Permissions");
    expect(hub).not.toContain("Location Permissions");
  });

  it("keeps the hamburger a fast hub rather than a duplicate Settings directory", () => {
    for (const label of [
      "Mad Buddy Access",
      "Progress",
      "Achievements",
      "Settings",
      "Privacy & Safety",
      "Glow & Visibility",
      "Invite Friends",
      "Help & Support",
      "Send Feedback",
      "About Mad Buddy"
    ]) {
      expect(hub, `${label} missing from the account hub`).toContain(label);
    }

    for (const settingsOnly of [
      "Sessions",
      "Nearby alerts",
      "Appearance",
      "Language & Region",
      "Data & Storage",
      "Delete account"
    ]) {
      expect(hub, `${settingsOnly} leaked into the fast account hub`).not.toContain(settingsOnly);
    }
  });
});

describe("A1 account hub interaction contract", () => {
  it("has no decorative drag affordance", () => {
    expect(hub).not.toContain("Drag handle");
    expect(hub).not.toContain('className="h-1 w-9 rounded-full');
  });

  it("has one explicit accessible close action", () => {
    expect(hub).toContain('aria-label="Close account menu"');
    expect(hub).toContain("<Dialog.Close");
  });

  it("keeps exactly one internal vertical scroll owner", () => {
    expect(hub.match(/overflow-y-auto/g) ?? []).toHaveLength(1);
    expect(hub).toContain("overscroll-contain");
  });

  it("keeps sign out outside normal navigation and safe-area aware", () => {
    expect(hub).toContain("env(safe-area-inset-bottom)");
    expect(hub).toContain('"Sign out"');
    expect(hub).toContain("border-t border-border/60");
  });

  it("renders no admin heading, row, or gap for unauthorized users", () => {
    expect(hub).toContain("showAdminLink ? <SheetGroup rows={ADMINISTRATION}");
    expect(hub).not.toContain("hidden={showAdminLink");
  });

  it("uses restrained utility icon colour and reserves primary colour for profile action", () => {
    expect(hub).toContain("text-[#4E0401]/65");
    expect(hub).toContain("text-primary");
    expect(hub).not.toContain("text-orange");
  });

  it("keeps About deliberately quieter than support actions", () => {
    expect(hub).toContain('label: "About Mad Buddy", icon: Info, emphasis: "quiet"');
  });

  it("does not decorate identity with stale plan tier or fake Glow status", () => {
    expect(hub).not.toContain("PremiumPlanBadge");
    expect(hub).not.toContain("premiumBadgeIdentity");
    expect(hub).not.toContain("avatar-ring-pro");
    expect(hub).not.toContain("GlowAvatar");
  });
});

describe("A1 invite route authority", () => {
  it("uses /invite for outbound Invite Friends", () => {
    expect(hub).toContain('{ href: "/invite", label: "Invite Friends"');
    expect(hub).not.toContain('{ href: "/invites", label: "Invite Friends"');
    expect(settings).toContain('href="/invite"');
  });

  it("keeps /invite and /invites as separate working product concepts", () => {
    expect(read("app/(app)/invite/page.tsx")).toContain("InviteBuddiesPage");
    expect(read("app/(app)/invites/page.tsx")).toContain("InvitesPageContent");
  });
});
