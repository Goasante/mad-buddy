import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isBuiltForMobile, toMobilePath } from "@/lib/platform/routes.mobile";

const read = (p: string) => readFileSync(p, "utf8");
const shared = read("components/settings/settings-page.tsx");
const webBoundary = read("components/settings/web-settings-page.tsx");
const mobileScreen = read("mobile/src/screens/SettingsScreen.tsx");
const importLines = (source: string) =>
  source.split(/\r?\n/).filter((line) => line.trimStart().startsWith("import ")).join("\n");

const destinations = [...shared.matchAll(/href="(\/[^"]*)"/g)].map((m) => m[1]);

describe("the Settings root is one shared navigation surface", () => {
  it("both platforms render the same component", () => {
    expect(webBoundary).toContain('from "@/components/settings/settings-page"');
    expect(webBoundary).toContain("<SettingsPageContent");
    expect(mobileScreen).toContain('from "@/components/settings/settings-page"');
    expect(mobileScreen).toContain("<SettingsPageContent");
  });

  it("keeps the root focused on navigation rather than duplicating live controls", () => {
    expect(shared).not.toContain("PrivacyToggle");
    expect(shared).not.toContain("LocationForGlowSetting");
    expect(shared).not.toContain('title="Nearby alerts"');
    expect(shared).not.toContain('title="Ghost Mode"');
    expect(shared).not.toContain('title="Privacy setup"');
    expect(shared).not.toContain('title="Reminders"');
    expect(shared).not.toContain('title="Focus & balance"');
  });

  it("leaves no second Settings implementation in native", () => {
    expect(mobileScreen).not.toContain("function SectionTitle");
    expect(mobileScreen).not.toContain("function Row(");
    expect(mobileScreen).not.toContain('title="Ghost Mode"');
    expect(mobileScreen.split("\n").length).toBeLessThan(200);
  });
});

describe("the shared root is safe for both runtimes", () => {
  it("imports no Next runtime module or Server Action", () => {
    const imports = importLines(shared);
    expect(imports).not.toMatch(/from\s+["']next\//);
    expect(imports).not.toContain("@/app/");
    expect(imports).not.toContain("settings-actions");
    expect(shared).toContain('from "@/lib/platform"');
  });

  it("injects web-only header and delete flow from the web boundary", () => {
    expect(importLines(shared)).not.toContain("app-shell/page-header");
    expect(importLines(shared)).not.toContain("delete-account-modal");
    expect(shared).toContain("{header}");
    expect(webBoundary).toContain('header={<PageHeader title="Settings" />}');
    expect(webBoundary).toContain("delete-account-modal");
  });
});

describe("root destinations are deliberate", () => {
  it("keeps the simplified root compact", () => {
    const distinct = [...new Set(destinations)];
    expect(distinct).toHaveLength(17);
  });

  it("Android gates every row through isBuiltForMobile", () => {
    expect(mobileScreen).toContain("isDestinationAvailable={isBuiltForMobile}");
  });

  it("web gates nothing because every root destination exists there", () => {
    expect(webBoundary).not.toContain("isDestinationAvailable");
  });

  it("unavailable native destinations render as disabled buttons", () => {
    expect(shared).toContain('aria-disabled="true"');
    expect(shared).toContain("Not in the Android app yet.");
    expect(shared).toMatch(/aria-label=\{\`\$\{title\}\. Not in the Android app yet\.\`\}/);
  });

  it("every destination is either reachable on Android or explicitly unavailable", () => {
    const nativeRoutes = new Set([
      "/home", "/muddies", "/messages", "/plans", "/events", "/moments",
      "/notifications", "/groups", "/pings", "/safety", "/subscription",
      "/socialize", "/profile", "/settings", "/settings/notifications",
      "/buddy-score", "/help", "/more", "/privacy", "/terms", "/onboarding"
    ]);
    for (const href of destinations) {
      if (!isBuiltForMobile(href)) continue;
      const mapped = toMobilePath(href).split("?")[0];
      expect(
        nativeRoutes.has(mapped),
        `${href} -> ${mapped} is neither a native route nor listed as unavailable`
      ).toBe(true);
    }
  });
});

describe("account actions stay platform-correct", () => {
  it("suppresses the web Danger zone unless a modal is injected", () => {
    expect(shared).toContain("{renderDeleteAccountModal ? (");
    expect(mobileScreen).not.toContain("renderDeleteAccountModal");
    expect(webBoundary).toContain("renderDeleteAccountModal={");
  });

  it("Android keeps sign out and two-step deletion", () => {
    expect(mobileScreen).toContain("Sign out");
    expect(mobileScreen).toContain("Delete my account");
    expect(mobileScreen).toContain('useState<"idle" | "confirm">');
    expect(mobileScreen).toContain("Delete your account permanently?");
  });

  it("Android signs out after deletion so its device token is unregistered", () => {
    const onDeleted = mobileScreen.slice(
      mobileScreen.indexOf("onDeleted={"),
      mobileScreen.indexOf("onDeleted={") + 400
    );
    expect(onDeleted).toContain("signOut()");
    expect(onDeleted.indexOf("signOut()")).toBeLessThan(onDeleted.indexOf("navigate("));
  });
});
