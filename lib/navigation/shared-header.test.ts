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

/**
 * The four defects found in the PR #88 artifact review. Each is pinned here
 * because all of them passed the test suite and both production builds --
 * they were runtime and artifact-boundary problems, not type or logic errors.
 */
describe("PR #88 review blockers stay fixed", () => {
  it("mobile defines the header-height variables the shared header needs", () => {
    // The header is `fixed` and sizes itself with
    // --app-header-content-height. Undefined on mobile, it collapsed and page
    // content rendered underneath it.
    const mobileCss = read("mobile/src/index.css");
    expect(mobileCss).toContain("--app-header-content-height");
    expect(mobileCss).toContain("--app-header-height");
  });

  /**
   * THE SAFE-AREA CONTRACT, which has three participants on mobile:
   *
   *   1. `body`   pays env(safe-area-inset-top) once, for everything in flow.
   *   2. header   pays it AGAIN for itself -- correctly, because `fixed`
   *               positions against the viewport and ignores body padding.
   *   3. <main>   is in flow, so body already covered its notch. It must
   *               offset by the header's CONTENT height only.
   *
   * Using --app-header-height (content + inset) at step 3 counts the notch
   * twice and opens a visible gap under the header. Each participant is
   * asserted separately so a change to any one of them fails here rather than
   * on a device.
   */
  it("mobile body pays the top inset once, for in-flow content", () => {
    const mobileCss = read("mobile/src/index.css");
    const bodyRule = mobileCss.slice(mobileCss.indexOf("\nbody {"), mobileCss.indexOf("@layer utilities"));
    expect(bodyRule).toContain("env(safe-area-inset-top)");
  });

  it("mobile <main> offsets by CONTENT height, not the inset-inclusive height", () => {
    /* JSX comments are stripped first. The code above <main> EXPLAINS this
       contract and names both variables, so searching the raw source finds
       "<main>" inside that prose rather than the element -- the assertion
       would then read the comment and fail on correct code. */
    const jsx = mobileShell.replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
    const mainStart = jsx.indexOf("<main");
    const mainAttributes = jsx.slice(mainStart, jsx.indexOf(">", mainStart + "<main".length));
    expect(mainAttributes).toContain('paddingTop: "var(--app-header-content-height)"');
    // The two failure modes, named explicitly:
    expect(mainAttributes).not.toContain("var(--app-header-height)");
    expect(mainAttributes).not.toContain("safe-area-inset-top");
  });

  it("the fixed header still pays its own inset, being outside body padding", () => {
    const headerTag = header.slice(header.indexOf("<header"), header.indexOf(">", header.indexOf("<header")));
    expect(headerTag).toContain("pt-[env(safe-area-inset-top,0px)]");
    expect(headerTag).toContain("fixed");
  });

  it("the two height variables stay distinct, so the choice remains available", () => {
    const mobileCss = read("mobile/src/index.css");
    // content-height must NOT bundle the inset; header-height must.
    expect(mobileCss).toMatch(/--app-header-content-height:\s*4\.25rem;/);
    expect(mobileCss).toMatch(
      /--app-header-height:\s*calc\(env\(safe-area-inset-top, 0px\) \+ var\(--app-header-content-height\)\)/
    );
  });

  it("web resolves the avatar through its own source hook", () => {
    // The shared header rendering currentAvatarUrl directly lost both the
    // /api/profile/avatar resolution and the madbuddy:avatar-updated
    // listener, so a newly saved photo could stay stale.
    expect(webShell).toContain("useAvatarSource={useWebAvatarSource}");
    const resolver = read("components/app-shell/use-web-avatar-source.ts");
    expect(resolver).toContain("madbuddy:avatar-updated");
    expect(resolver).toContain("/api/profile/avatar");
  });

  it("mobile registers the menus so Back closes them", () => {
    // The old native header registered its dropdowns with the overlay stack,
    // so hardware Back closed them instead of leaving the screen.
    expect(mobileShell).toContain("useOverlayDismiss={useOverlayDismiss}");
    expect(mobileShell).toContain('from "../lib/overlay"');
  });

  it("web does NOT register them, which would cancel navigation", () => {
    // Web's equivalent hook calls history.back() on cleanup, reversing the
    // in-flight App Router transition a menu item just started.
    const headerUsage = webShell.slice(webShell.indexOf("<AppHeader"), webShell.indexOf("<AppHeader") + 700);
    expect(headerUsage).not.toContain("useOverlayDismiss");
  });
});
