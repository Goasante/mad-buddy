import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/lib/content/strip-comments";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const shell = read("components/app-shell/app-shell.tsx");
const orb = read("components/app-shell/mad-buddy-orb.tsx");
const registry = read("lib/tours/registry.ts");
const css = read("app/globals.css");

/** The orb's own CSS block, isolated from the rest of the stylesheet. */
const orbCss = css.slice(
  css.indexOf("/* Mad Buddy Orb"),
  // Bounded: later blocks (the Socialize status control and radar field) have
  // their own palettes and motion, which are not the Orb's to police.
  css.indexOf("/* Socialize status control")
);
const orbRules = stripComments(orbCss);

/** The mobile bar only, so desktop chrome cannot satisfy an assertion. */
const mobileNav = shell.slice(shell.indexOf("function MobileNav("), shell.indexOf("function MobileNavTab"));

// ---------------------------------------------------------------------------
// Navigation order
// ---------------------------------------------------------------------------

describe("bottom navigation order", () => {
  it("is Messages, Muddies, Orb, Linkr, UpFor", () => {
    const tabs = shell.slice(shell.indexOf("const MOBILE_TABS"), shell.indexOf("function MobileNav("));
    const order = [...tabs.matchAll(/label: "([^"]+)"/g)].map((match) => match[1]);
    // The Orb is not a MOBILE_TABS entry — it is rendered between the two
    // halves, so the four labelled tabs split two and two around it.
    // Plans and Profile were removed rather than demoted: Plans already has a
    // section on Home, and Profile is the first row of the account sheet, so
    // both were paying for a permanent tab they did not need.
    expect(order).toEqual(["Messages", "Muddies", "Linkr", "UpFor"]);
    expect(mobileNav).toContain("MOBILE_TABS.slice(0, 2)");
    expect(mobileNav).toContain("MOBILE_TABS.slice(2)");
  });

  it("puts the Orb between the two halves", () => {
    const left = mobileNav.indexOf("leftTabs.map");
    const centre = mobileNav.indexOf("<MadBuddyOrb");
    const right = mobileNav.indexOf("rightTabs.map");
    expect(left).toBeLessThan(centre);
    expect(centre).toBeLessThan(right);
  });

  it("no longer lists Home as its own tab", () => {
    const tabs = shell.slice(shell.indexOf("const MOBILE_TABS"), shell.indexOf("function MobileNav("));
    expect(tabs).not.toContain('label: "Home"');
    expect(tabs).not.toContain('href: "/dashboard"');
  });

  it("routes Messages to the existing route", () => {
    expect(shell).toContain('{ href: "/messages", label: "Messages", icon: MessageCircle }');
  });

  it("leaves the other destinations untouched", () => {
    for (const href of ["/friends", "/plans", "/profile"]) {
      expect(shell, `${href} must still be a tab`).toContain(`href: "${href}"`);
    }
  });
});

// ---------------------------------------------------------------------------
// The floating action menu is gone
// ---------------------------------------------------------------------------

describe("floating create menu removal", () => {
  it("removes the centre + and its popup from the mobile bar", () => {
    expect(mobileNav).not.toContain("CirclePlus");
    expect(mobileNav).not.toContain("DropdownMenu");
    expect(mobileNav).not.toContain("createOpen");
  });

  it("does not recreate the popup anywhere in the mobile bar", () => {
    expect(mobileNav).not.toContain("createActions");
  });

  it("keeps the desktop header create menu, which was not in scope", () => {
    // The brief replaced the CENTRE navigation architecture only.
    //
    // Asserts the menu still EXISTS rather than one variable spelling. The
    // list was renamed to createActionDefinitions when the shell began
    // filtering it against the paused-feature list -- the menu is intact, and
    // pinning the old identifier would have made a rename look like a
    // regression while a genuine deletion still passed.
    expect(shell).toMatch(/createActionDefinitions|const createActions/);
    expect(shell).toContain("visibleCreateActions.map((action)");
  });

  it("retires the nav-create tour target", () => {
    expect(stripComments(registry)).not.toContain("nav-create");
  });

  it("keeps a tour target on the Orb and adds one for Messages", () => {
    expect(registry).toContain('id: "nav-dashboard"');
    expect(registry).toContain('id: "nav-messages"');
    expect(orb).toContain('data-tour-id="nav-dashboard"');
  });
});

// ---------------------------------------------------------------------------
// The Orb
// ---------------------------------------------------------------------------

describe("Mad Buddy Orb", () => {
  it("carries the Home mark and no text label", () => {
    // The Orb now carries the brand Home mark inside its gradient. Its glow
    // layers are untouched, and it still has no visible text — the accessible
    // name lives on the link.
    expect(orb).toContain("<HomeMarkIcon");
    expect(orb).toContain('aria-label="Home"');
    expect(orb).not.toContain(">Home<");
  });

  it("is a perfect circle in the 56-60px range", () => {
    expect(orbRules).toContain("width: 58px");
    expect(orbRules).toContain("height: 58px");
    expect(orbRules).toContain("border-radius: 999px");
  });

  it("has a warm gradient core, an outer glow and glass depth", () => {
    expect(orbRules).toContain("--color-brand-orange");
    expect(orbRules).toContain("linear-gradient(150deg");
    expect(orbRules).toContain("radial-gradient(");
    expect(orbRules).toContain("mix-blend-mode: soft-light");
  });

  it("floats on a soft shadow rather than a thick border", () => {
    expect(orbRules).toContain("box-shadow:");
    expect(orbRules).not.toContain("border:");
    expect(orbRules).not.toContain("border-width");
  });

  it("stays calm — no neon and no rainbow", () => {
    // One hue family only: the brand orange and its two gradient stops.
    const hexes = new Set([...orbRules.matchAll(/#[0-9a-f]{6}/gi)].map((match) => match[0].toLowerCase()));
    for (const hex of hexes) {
      expect(["#f2a855", "#c96f18", "#ffffff", "#fff"], `unexpected colour ${hex}`).toContain(hex);
    }
    expect(orbRules).not.toContain("conic-gradient");
  });

  it("keeps the light decorative so it cannot swallow the tap", () => {
    expect(orbRules).toContain("pointer-events: none");
    expect(orb).toContain('aria-hidden="true"');
  });
});

// ---------------------------------------------------------------------------
// Motion
// ---------------------------------------------------------------------------

describe("orb motion", () => {
  it("breathes 1 → 1.03 → 1", () => {
    expect(orbRules).toContain("@keyframes mb-orb-breathe");
    expect(orbRules).toContain("scale(1.03)");
  });

  it("brightens the glow on the same breath", () => {
    expect(orbRules).toContain("@keyframes mb-orb-glow");
    const glow = orbRules.slice(orbRules.indexOf("@keyframes mb-orb-glow"));
    expect(glow).toContain("opacity: 0.8");
  });

  it("rests between breaths rather than pulsing continuously", () => {
    // The scale holds at rest for ~86% of a 7s cycle, so the movement is
    // periodic rather than a constant throb.
    expect(orbRules).toContain("animation: mb-orb-breathe 7s");
    const breathe = orbRules.slice(orbRules.indexOf("@keyframes mb-orb-breathe"), orbRules.indexOf("@keyframes mb-orb-glow"));
    expect(breathe).toContain("86%");
  });

  it("is CSS-driven with no JavaScript animation loop", () => {
    for (const banned of ["requestAnimationFrame", "setInterval", "setTimeout"]) {
      expect(orb, `orb must not run ${banned}`).not.toContain(banned);
    }
  });

  it("dips and contracts its glow on press", () => {
    expect(orbRules).toContain(".mb-orb:active");
    expect(orbRules).toContain("scale(0.93)");
  });
});

describe("active state", () => {
  it("brightens the glow, thickens the ring and deepens the shadow", () => {
    const active = orbRules.slice(orbRules.indexOf(".mb-orb.is-active"));
    expect(active).toContain("0 8px 22px");
    expect(active).toContain("opacity: 0.78");
    expect(active).toContain("inset: -9px");
  });

  it("is driven by the shared route-matching rule", () => {
    expect(mobileNav).toContain("isNavigationItemActive(");
    expect(mobileNav).toContain("isActive={homeActive}");
    expect(mobileNav).toContain("onHomeReselect={onHomeReselect}");
  });
});

// ---------------------------------------------------------------------------
// Home behaviour
// ---------------------------------------------------------------------------

describe("Home behaviour", () => {
  it("is a real link, so routing and prefetch behave like every other tab", () => {
    expect(orb).toContain("<Link");
    expect(orb).toContain("href={ORB_HOME_HREF}");
    expect(orb).toContain('export const ORB_HOME_HREF = "/dashboard"');
  });

  it("navigates normally when Home is not the current screen", () => {
    expect(orb).toContain("if (!isActive) return;");
  });

  it("opens the camera composer when Home is already active", () => {
    expect(orb).toContain("onHomeReselect?.()");
  });

  it("does not depend on a timing-based double tap", () => {
    expect(orb).not.toContain("setTimeout");
    expect(orb).not.toContain("Date.now");
  });

  it("never resets the page, refreshes or reopens anything", () => {
    for (const banned of ["router.refresh", "router.replace", "location.reload", "setOpen", "Sheet", "SmartCard"]) {
      expect(orb, `orb must not ${banned}`).not.toContain(banned);
    }
  });

  it("leaves modified clicks to the browser", () => {
    expect(orb).toContain("event.metaKey || event.ctrlKey || event.shiftKey || event.altKey");
  });
});

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

describe("activity accent", () => {
  it("is architected but carries no count", () => {
    expect(orb).toContain("hasActivity");
    expect(orbRules).toContain(".mb-orb.has-activity::after");
    // A boolean, never a number: the accent cannot become a counter.
    expect(orb).toContain("hasActivity?: boolean;");
    expect(stripComments(orb)).not.toMatch(/count/i);
    expect(orbRules).not.toContain("content: attr(");
  });

  it("is not a red badge", () => {
    const accent = orbRules.slice(orbRules.indexOf(".mb-orb.has-activity::after"));
    // No red anywhere in the accent's colours — it is white on a warm ring.
    expect(accent).not.toMatch(/red/);
    expect(accent).not.toContain("destructive");
    expect(accent).toContain("background: #fff");
    // A small warm dot, not a counter bubble.
    expect(accent).toContain("width: 9px");
  });
});

// ---------------------------------------------------------------------------
// Accessibility
// ---------------------------------------------------------------------------

describe("orb accessibility", () => {
  it("is announced as Home", () => {
    expect(orb).toContain('aria-label="Home"');
    expect(orb).toContain('aria-current={isActive ? "page" : undefined}');
  });

  it("keeps the existing hit target", () => {
    // Same min-height as every other tab in the bar.
    expect(orb).toContain("min-h-[56px]");
    expect(shell).toContain("min-h-[56px]");
  });

  it("keeps a visible keyboard focus ring", () => {
    expect(orb).toContain("focus-visible:ring-2");
  });

  it("falls back to a static glow under reduced motion", () => {
    const reduced = orbRules.slice(orbRules.indexOf("prefers-reduced-motion"));
    expect(reduced).toContain("animation: none");
    expect(reduced).toContain("transform: none");
    // The light itself stays — only the movement stops.
    expect(reduced).not.toContain("display: none");
    expect(reduced).not.toContain("opacity: 0;");
  });

});
