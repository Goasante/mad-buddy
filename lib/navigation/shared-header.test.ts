import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The shared app header.
 *
 * The native app had its own hand-written header -- its own Create dropdown,
 * bell and account menu -- none of which tracked the web app. Both shells now
 * render the same component.
 *
 * The header carries one hazard the bottom bar did not: logging out. Web
 * clears the session through a Server Action; Android must remove the device's
 * push token FIRST or a signed-out phone keeps receiving notifications. Most
 * of this file guards that the two are not collapsed into one.
 */

const read = (path: string) => readFileSync(path, "utf8");
const header = read("components/app-shell/app-header.tsx");
const webShell = read("components/app-shell/app-shell.tsx");
const mobileShell = read("mobile/src/components/AppShell.tsx");

describe("the header is shared, not duplicated", () => {
  it("lives in its own module", () => {
    expect(header).toContain("export function AppHeader");
    expect(header).toContain("export function AccountMenu");
  });

  it("is imported by both shells", () => {
    expect(webShell).toContain('from "@/components/app-shell/app-header"');
    expect(webShell).toContain("<AppHeader");
    expect(mobileShell).toContain('from "@/components/app-shell/app-header"');
    expect(mobileShell).toContain("<AppHeader");
  });

  it("reaches framework APIs only through the platform adapter", () => {
    expect(header).not.toMatch(/from\s+["']next\//);
    expect(header).toContain('from "@/lib/platform"');
  });

  it("leaves no second header behind in the native shell", () => {
    // The old Create list, its dropdown and its account rows must be gone,
    // or the two could drift again.
    expect(mobileShell).not.toContain('title: "New plan"');
    expect(mobileShell).not.toContain("function Dropdown(");
    expect(mobileShell).not.toContain("function AccountItem(");
  });
});

describe("logout stays platform-specific", () => {
  it("the header never imports a logout implementation", () => {
    // Importing useSecureLogout here would drag a Server Action into the
    // mobile bundle AND bypass Android's push-token cleanup.
    //
    // Asserted against IMPORT STATEMENTS rather than the whole file: the file
    // deliberately explains this rule in prose, and that prose names the hook.
    const imports = header
      .split(/\r?\n/)
      .filter((line) => line.trimStart().startsWith("import "))
      .join("\n");
    expect(imports).not.toContain("useSecureLogout");
    expect(imports).not.toContain("@/app/");
    expect(header).toContain("onLogout");
  });

  it("web passes its Server-Action logout", () => {
    expect(webShell).toContain("useSecureLogout()");
    expect(webShell).toContain("onLogout={logout}");
  });

  it("Android passes signOut, which clears the push token first", () => {
    expect(mobileShell).toContain("onLogout={() => { void signOut(); }}");
    const auth = read("mobile/src/auth/AuthProvider.tsx");
    const signOutBody = auth.slice(auth.indexOf("signOut: async"), auth.indexOf("signOut: async") + 220);
    // Order matters: the token must go before the session, or the call that
    // removes it has no session to authorise with.
    expect(signOutBody.indexOf("removeCurrentDeviceToken")).toBeLessThan(
      signOutBody.indexOf("supabase.auth.signOut")
    );
  });
});

describe("destinations the native app lacks are not offered", () => {
  it("the menu filters by platform availability", () => {
    expect(header).toContain("isDestinationAvailable");
    // A menu can simply omit an entry -- unlike the bottom bar's fixed slots,
    // there is no layout to preserve.
    expect(header).toContain("ACCOUNT_MENU_ENTRIES.filter");
  });

  it("Android gates with isBuiltForMobile", () => {
    expect(mobileShell).toContain("isDestinationAvailable={isBuiltForMobile}");
  });

  it("web offers everything, because it has everything", () => {
    const headerUsage = webShell.slice(webShell.indexOf("<AppHeader"), webShell.indexOf("<AppHeader") + 500);
    expect(headerUsage).not.toContain("isDestinationAvailable=");
  });

  it("Admin is marked as not built for mobile", () => {
    // It is web-only by nature. showAdminLink answers "may this person see
    // Admin", not "does this platform have it" -- both need answering, or an
    // owner on Android taps through to the unavailable screen.
    const routes = read("lib/platform/routes.mobile.ts");
    expect(routes).toContain('"/admin"');
  });
});

describe("the notifications bell appears exactly once per platform", () => {
  it("is off by default, so web is unchanged", () => {
    // Web pages render their own MobilePageHeader, which already has a bell.
    expect(header).toContain("showNotificationsBell = false");
    const headerUsage = webShell.slice(webShell.indexOf("<AppHeader"), webShell.indexOf("<AppHeader") + 500);
    expect(headerUsage).not.toContain("showNotificationsBell");
  });

  it("Android opts in, having no per-page header", () => {
    expect(mobileShell).toContain("showNotificationsBell");
  });
});

describe("one destination for Access, not three", () => {
  it("uses the canonical /settings/access", () => {
    // Web's account menu was on the retired /billing, the sidebar had already
    // moved, and the native app used its own /subscription. Sharing forces one.
    expect(header).toContain('{ href: "/settings/access", label: "Mad Buddy Access"');
    expect(header).not.toContain('{ href: "/billing"');
  });

  it("maps to the native screen", () => {
    const routes = read("lib/platform/routes.mobile.ts");
    expect(routes).toContain('"/settings/access": "/subscription"');
  });
});

describe("the paused Moments shortcut stays gone", () => {
  it("is absent from the shared Create menu", () => {
    // Moments is paused on web: the route redirects to /dashboard, so the
    // shortcut promised a destination that bounced the person back to Home.
    // The native app carried its own copy; sharing removes it there too.
    expect(header).not.toContain('title: "Share a Moment"');
    expect(mobileShell).not.toContain('title: "Share a Moment"');
  });
});
