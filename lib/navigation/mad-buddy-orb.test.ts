import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
/* The mobile bottom bar and its tab list moved to their own module so the
   Capacitor SPA renders the SAME navigation. Assertions unchanged. */
const navSource = read("components/app-shell/mobile-nav.tsx");
const homeControl = read("components/app-shell/mad-buddy-orb.tsx");
const registry = read("lib/tours/registry.ts");

/** The mobile bar only, so desktop chrome cannot satisfy an assertion. */
const mobileNav = navSource.slice(navSource.indexOf("export function MobileNav("), navSource.indexOf("function MobileNavTab"));

describe("bottom navigation order", () => {
  it("keeps Messages, Muddies, Home, Linkr, UpFor", () => {
    const tabs = navSource.slice(navSource.indexOf("export const MOBILE_TABS"), navSource.indexOf("export function MobileNav("));
    const order = [...tabs.matchAll(/label: "([^"]+)"/g)].map((match) => match[1]);
    expect(order).toEqual(["Messages", "Muddies", "Linkr", "Meetups"]);
    expect(mobileNav).toContain("MOBILE_TABS.slice(0, 2)");
    expect(mobileNav).toContain("MOBILE_TABS.slice(2)");

    const left = mobileNav.indexOf("leftTabs.map");
    const centre = mobileNav.indexOf("<MadBuddyOrb");
    const right = mobileNav.indexOf("rightTabs.map");
    expect(left).toBeLessThan(centre);
    expect(centre).toBeLessThan(right);
  });

  it("keeps Home as the dedicated centre control rather than duplicating it in MOBILE_TABS", () => {
    const tabs = navSource.slice(navSource.indexOf("export const MOBILE_TABS"), navSource.indexOf("export function MobileNav("));
    expect(tabs).not.toContain('label: "Home"');
    expect(tabs).not.toContain('href: "/dashboard"');
  });
});

describe("Home navigation visual", () => {
  it("uses the approved solid house and always-visible label", () => {
    expect(homeControl).toContain('<NavigationGlyph name="home"');
    expect(homeControl).toContain('h-[28px] w-[28px]');
    expect(homeControl).toContain('mobile-nav-label max-w-full truncate">Home');
    expect(homeControl).not.toContain('bg-[#4E0401]');
    expect(homeControl).not.toContain('import { Home } from "lucide-react"');
  });

  it("keeps activity as a small orange accent, never a count", () => {
    expect(homeControl).toContain("hasActivity?: boolean;");
    expect(homeControl).toContain('bg-[#E88C2B]');
    expect(homeControl).not.toMatch(/activityCount|unreadCount|badgeCount/);
  });
});

describe("Home behaviour", () => {
  it("remains a real /dashboard link", () => {
    expect(homeControl).toContain("<Link");
    expect(homeControl).toContain("href={ORB_HOME_HREF}");
    expect(homeControl).toContain('export const ORB_HOME_HREF = "/dashboard"');
    expect(homeControl).toContain("prefetch={false}");
  });

  it("navigates normally when Home is inactive and preserves Home reselect when active", () => {
    expect(homeControl).toContain("if (!isActive) return;");
    expect(homeControl).toContain("event.preventDefault();");
    expect(homeControl).toContain("onHomeReselect?.()");
  });

  it("leaves modified clicks to the browser", () => {
    expect(homeControl).toContain("event.metaKey || event.ctrlKey || event.shiftKey || event.altKey");
  });

  it("does not introduce timing-based double-tap behaviour", () => {
    expect(homeControl).not.toContain("setTimeout");
    expect(homeControl).not.toContain("Date.now");
  });

  it("uses the shared route matcher for its active state", () => {
    expect(mobileNav).toContain("isNavigationItemActive(");
    expect(mobileNav).toContain("isActive={homeActive}");
  });
});

describe("Home accessibility and tours", () => {
  it("is announced as Home and marks the current page", () => {
    expect(homeControl).toContain('aria-label="Home"');
    expect(homeControl).toContain('aria-current={isActive ? "page" : undefined}');
  });

  it("keeps the 56px row target and visible keyboard focus", () => {
    expect(homeControl).toContain("min-h-[56px]");
    expect(homeControl).toContain("focus-visible:ring-2");
  });

  it("preserves the existing guided-tour target", () => {
    expect(homeControl).toContain('data-tour-id="nav-dashboard"');
    expect(registry).toContain('id: "nav-dashboard"');
  });

  it("honours reduced-motion users", () => {
    expect(homeControl).toContain("motion-reduce:transition-none");
    expect(homeControl).toContain("motion-reduce:active:scale-100");
  });
});
