import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");

/**
 * Regression guard for the navigation stall introduced in 98194b9.
 *
 * useDismissOnBack pushes a history sentinel while an overlay is open and pops
 * it (history.back()) when the overlay closes. On an overlay whose items are
 * navigation links, the close IS the click that starts the navigation, so the
 * pop fired while the App Router transition was still in flight and reversed
 * it: the route never committed, the pathname never changed, and the 15s
 * NavigationWatchdog reported "navigation did not complete". Only the account
 * dropdown's destinations (Profile/Settings/Billing/Help/Admin) were affected,
 * because only that menu combined the hook with <Link> children.
 */
describe("navigation is never cancelled by the back-dismiss sentinel", () => {
  /* The account menu moved to app-header.tsx so the Capacitor SPA renders the
     SAME header. The invariant is unchanged and still what matters: those
     items must be real Links, because useDismissOnBack would cancel an
     in-flight navigation started from a button. */
  const appShell =
    readFileSync(join(ROOT, "components/app-shell/app-shell.tsx"), "utf8") +
    readFileSync(join(ROOT, "components/app-shell/app-header.tsx"), "utf8");

  it("the app shell's link menus do not use useDismissOnBack", () => {
    // The shell's menus (account dropdown, create menu) render <Link>s. If the
    // hook is reintroduced here, first-click navigation from those menus
    // silently breaks again and only a hard reload recovers.
    const activeCalls = appShell
      .split("\n")
      .filter((line) => line.includes("useDismissOnBack(") && !line.trimStart().startsWith("//"));
    expect(activeCalls).toEqual([]);
  });

  it("the shell still renders the account menu's navigation links", () => {
    // Guards against "fixing" the above by deleting the menu itself.
    //
    // The entries are now data (ACCOUNT_MENU_ENTRIES in app-header.tsx, shared
    // with the Capacitor SPA) rather than hand-written JSX, so this checks the
    // destinations themselves instead of a literal href attribute. Same
    // intent: the menu must still offer these places.
    //
    // "/billing" is deliberately absent. The MONETIZATION RESET made
    // /settings/access canonical and the sidebar followed; the account menu had
    // been left behind on the old three-tier upgrade route, and the native app
    // pointed at a third destination. One shared menu forces one answer.
    for (const href of ["/profile", "/settings", "/settings/access", "/help", "/admin"]) {
      expect(appShell).toContain(`href: "${href}"`);
    }
  });

  it("those entries are rendered as Links, not buttons", () => {
    // The real point of this file: a menu item that navigates via onClick
    // would be cancelled by useDismissOnBack's cleanup. Radix renders the
    // item `asChild` around a Link, which is what keeps the navigation alive.
    const header = readFileSync(join(ROOT, "components/app-shell/app-header.tsx"), "utf8");
    const accountMenu = header.slice(header.indexOf("export function AccountMenu"));
    expect(accountMenu).toContain("<Link href={entry.href}");
    expect(accountMenu).toContain("asChild");
  });

  it("the back-dismiss hook never performs a history navigation", () => {
    // The actual invariant. A pop on the current route is seen by the App
    // Router as a route change, which cancelled in-flight menu navigations AND
    // reverted post-mutation state (Socialize/Hangout activating, then showing
    // OFF again). Neutralising the sentinel with replaceState has neither
    // effect. Back-to-close still works: that path pops before this cleanup
    // runs, so the `mbSheet` guard skips it.
    const hook = readFileSync(join(ROOT, "hooks/use-dismiss-on-back.ts"), "utf8");
    const code = hook
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("*") && !line.trimStart().startsWith("//"))
      .join("\n");
    expect(code).not.toMatch(/history\.(back|forward|go)\s*\(/);
    expect(code).toContain("window.history.replaceState");
    // The sentinel push is what makes Back-to-close possible at all.
    expect(code).toContain("window.history.pushState");
  });
});
