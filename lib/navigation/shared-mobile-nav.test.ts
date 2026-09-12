import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The shared mobile bottom bar.
 *
 * This bar is now rendered by BOTH the Next.js web app and the Capacitor SPA,
 * which is the point: the native app had its own hand-written nav
 * (Home/Muddies/Pulse/Messages/Plans) that drifted months behind web and was
 * the most visible symptom of maintaining two apps.
 *
 * Sharing it introduces one new hazard, and most of this file guards it:
 * two of the four destinations (Linkr, UpFor) do not exist in the native app
 * yet. They must not silently route somewhere else.
 */

const read = (path: string) => readFileSync(path, "utf8");
const nav = read("components/app-shell/mobile-nav.tsx");
const mobileShell = read("mobile/src/components/AppShell.tsx");
const mobileRouter = read("mobile/src/App.tsx");

describe("the bar is shared, not duplicated", () => {
  it("lives in its own module so both platforms can import it", () => {
    expect(nav).toContain("export function MobileNav");
    expect(nav).toContain("export const MOBILE_TABS");
  });

  it("is imported by the web shell", () => {
    const shell = read("components/app-shell/app-shell.tsx");
    expect(shell).toContain('from "@/components/app-shell/mobile-nav"');
    expect(shell).toContain("<MobileNav");
  });

  it("is imported by the native shell", () => {
    expect(mobileShell).toContain('from "@/components/app-shell/mobile-nav"');
    expect(mobileShell).toContain("<MobileNav");
  });

  it("reaches framework APIs only through the platform adapter", () => {
    // A direct next/* import here would break the Vite build outright.
    expect(nav).not.toMatch(/from\s+["']next\//);
    expect(nav).toContain('from "@/lib/platform"');
  });

  it("leaves no second navigation behind in the native shell", () => {
    // The old bar's tab list and NavLink markup must be gone, or the two
    // could drift again.
    expect(mobileShell).not.toContain('label: "Pulse"');
    expect(mobileShell).not.toContain("NavLink");
  });
});

describe("destinations the native app does not have are never silently rerouted", () => {
  it("web enables every destination, because it has them all", () => {
    // Web must not PASS the prop -- omitting it is what leaves every tab
    // enabled and keeps web behaviour byte-identical. The identifier may
    // still appear in prose explaining why, so this checks the JSX only.
    const shell = read("components/app-shell/app-shell.tsx");
    const navUsage = shell.slice(shell.indexOf("<MobileNav"), shell.indexOf("<MobileNav") + 400);
    expect(navUsage).not.toContain("isDestinationAvailable=");
  });

  it("the native shell gates destinations with isBuiltForMobile", () => {
    expect(mobileShell).toContain("isDestinationAvailable={isBuiltForMobile}");
    expect(mobileShell).toContain('from "@/lib/platform"');
  });

  it("an unavailable tab renders a button, never a link", () => {
    // aria-disabled on an anchor still lets it be followed, and <a> has no
    // real disabled attribute. Only a button genuinely cannot navigate.
    const disabledBranch = nav.slice(nav.indexOf("if (unavailable)"), nav.indexOf("/* `min-w-0` matters"));
    expect(disabledBranch).toContain("<button");
    expect(disabledBranch).toContain('type="button"');
    expect(disabledBranch).not.toContain("<Link");
  });

  it("carries its state in the accessible name, not only in the dimming", () => {
    // Opacity is invisible to a screen reader, so the reason must be spoken.
    expect(nav).toContain("Coming soon on Android.");
    expect(nav).toContain('aria-disabled="true"');
  });

  it("keeps the tab focusable so the reason is discoverable", () => {
    // Removing it from the tab order would hide the explanation from exactly
    // the people who cannot see the dimming.
    const disabledBranch = nav.slice(nav.indexOf("if (unavailable)"), nav.indexOf("/* `min-w-0` matters"));
    expect(disabledBranch).not.toContain("tabIndex={-1}");
    expect(disabledBranch).toContain("focus-visible:ring");
  });

  it("keeps the slot rather than hiding it, so both platforms share one layout", () => {
    const disabledBranch = nav.slice(nav.indexOf("if (unavailable)"), nav.indexOf("/* `min-w-0` matters"));
    expect(disabledBranch).toContain("min-w-0 flex-1 pb-0 pt-4");
    expect(disabledBranch).toContain("opacity-40");
  });

  it("announces the notice politely rather than as an alert", () => {
    // It answers a deliberate tap: confirmation, not an interruption.
    expect(nav).toContain('role="status"');
    expect(nav).toContain('aria-live="polite"');
  });
});

describe("an unknown route explains itself instead of redirecting", () => {
  it("no longer bounces the catch-all to Home", () => {
    // `<Navigate to="/home" replace />` sent anyone reaching a missing route
    // to Home with no message, and `replace` discarded the history entry so
    // the back button could not undo it. That reads as a broken app.
    expect(mobileRouter).not.toMatch(/path="\*"[^>]*Navigate to="\/home"/);
  });

  it("renders the unavailable screen behind the auth guard", () => {
    expect(mobileRouter).toContain("<UnavailableScreen />");
    // Signed-out users still reach /login first, like every other route.
    expect(mobileRouter).toMatch(/path="\*"[\s\S]{0,120}RequireAuth/);
  });

  it("keeps Navigate for the genuine auth redirects", () => {
    // Only the catch-all changed; the login/onboarding guards still redirect.
    expect(mobileRouter).toContain('<Navigate to="/login" replace />');
  });
});
