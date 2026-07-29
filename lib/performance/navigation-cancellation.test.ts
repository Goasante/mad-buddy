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
  const appShell = readFileSync(join(ROOT, "components/app-shell/app-shell.tsx"), "utf8");

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
    for (const href of ["/profile", "/settings", "/billing", "/help", "/admin"]) {
      expect(appShell).toContain(`href="${href}"`);
    }
  });

  it("the hook documents that it must not wrap navigation links", () => {
    const hook = readFileSync(join(ROOT, "hooks/use-dismiss-on-back.ts"), "utf8");
    expect(hook).toMatch(/NEVER use this on an overlay that contains navigation links/i);
    // The pop itself is still correct for form/action sheets — it should stay.
    expect(hook).toContain("window.history.back()");
  });
});
