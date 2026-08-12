import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { stripComments } from "@/lib/content/strip-comments";
import {
  QUICK_ACTIONS,
  QUICK_ACTION_COUNT,
  showsQuickActions
} from "@/lib/navigation/quick-actions";
import { FEATURE_ICON_SOURCES } from "@/lib/icons/feature-icons";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const component = stripComments(read("components/app-shell/quick-actions-launcher.tsx"));
const shell = stripComments(read("components/app-shell/app-shell.tsx"));
const haptics = stripComments(read("lib/device/haptics.ts"));
const css = read("app/globals.css");

// ---------------------------------------------------------------------------
// 1 + 2. Route visibility
// ---------------------------------------------------------------------------

describe("the launcher appears throughout the app", () => {
  it("shows on every ordinary screen", () => {
    // POLICY REVERSED, deliberately. This was an allow list of four browsing
    // surfaces; a shortcut that exists on four screens is one nobody learns is
    // there. It now appears everywhere it can.
    for (const path of [
      "/dashboard",
      "/friends",
      "/discover",
      "/hangout-mode",
      "/plans",
      "/events",
      "/groups",
      "/moments",
      "/messages",
      "/notifications",
      "/profile",
      "/settings",
      "/badges",
      "/buddy-score"
    ]) {
      expect(showsQuickActions(path), `${path} should show quick actions`).toBe(true);
    }
  });

  it("stays off surfaces that cannot carry it", () => {
    // /scan is a viewfinder whose shutter sits where the pill would land.
    // /safe-arrival is a safety surface; nothing floats over check-in controls.
    expect(showsQuickActions("/scan")).toBe(false);
    expect(showsQuickActions("/safe-arrival")).toBe(false);
  });

  it("leaves detail routes their own corner", () => {
    // Each of these has its own primary action low on the screen. The parent
    // list shows the launcher; the detail view does not.
    for (const path of [
      "/friends/ama",
      "/messages/abc123",
      "/plans/123",
      "/groups/456",
      "/events/789"
    ]) {
      expect(showsQuickActions(path), `${path} should NOT show quick actions`).toBe(false);
    }
  });

  it("ignores query strings and hashes", () => {
    // ?create=1 must not turn a surface into a different route.
    expect(showsQuickActions("/plans?create=1")).toBe(true);
    expect(showsQuickActions("/friends?tab=all")).toBe(true);
    expect(showsQuickActions("/scan?mode=qr")).toBe(false);
  });

  it("handles a missing pathname without throwing", () => {
    expect(showsQuickActions(null)).toBe(false);
    expect(showsQuickActions(undefined)).toBe(false);
    expect(showsQuickActions("")).toBe(false);
  });

  it("excludes by characteristic rather than by inventory", () => {
    // The deny list names full-screen and corner-owning surfaces, so the rule
    // describes a shape instead of enumerating every route in the app.
    const routeModule = stripComments(read("lib/navigation/quick-actions.ts"));
    expect(routeModule).toContain("EXCLUDED_SURFACES");
    expect(routeModule).toContain("EXCLUDED_PREFIXES");
  });

  it("needs no rule for routes outside the app shell", () => {
    // Login, signup, onboarding, admin and billing live outside the (app)
    // group and never render the shell, so they cannot show the launcher
    // whatever this function returns.
    const routeModule = stripComments(read("lib/navigation/quick-actions.ts"));
    expect(routeModule).not.toContain('"/login"');
    expect(routeModule).not.toContain('"/signup"');
    expect(routeModule).not.toContain('"/onboarding"');
  });
});

// ---------------------------------------------------------------------------
// 9. Canonical destinations
// ---------------------------------------------------------------------------

describe("every action opens its canonical route", () => {
  it("carries exactly the five features the brief names", () => {
    expect(QUICK_ACTIONS.map((action) => action.id)).toEqual([
      "moments",
      "plans",
      "events",
      "safe_arrival",
      "groups"
    ]);
  });

  it("points at the real feature pages, never a duplicate", () => {
    const routes = Object.fromEntries(QUICK_ACTIONS.map((action) => [action.id, action.href]));
    expect(routes.moments).toBe("/moments");
    expect(routes.plans).toBe("/plans");
    expect(routes.events).toBe("/events");
    expect(routes.safe_arrival).toBe("/safe-arrival");
    expect(routes.groups).toBe("/groups");
  });

  it("never includes the camera", () => {
    // Mad Cam belongs to the Home tab's tap/double-tap gesture. A second entry
    // point with a different gesture would be one feature, two contracts.
    const ids = QUICK_ACTIONS.map((action) => action.id).join(" ");
    expect(ids).not.toContain("camera");
    expect(component).not.toContain("CameraComposer");
    expect(component).not.toContain("getUserMedia");
  });

  it("opens the same destination regardless of the current page", () => {
    // No context-dependent behaviour in v1: Plans opens Plans everywhere.
    expect(component).not.toContain("pathname ===");
    expect(component).toContain("selectAction(action.href)");
  });
});

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

describe("actions are distinguishable at small sizes", () => {
  it("uses the central feature icon mapping", () => {
    for (const action of QUICK_ACTIONS) {
      expect(FEATURE_ICON_SOURCES[action.featureIcon], `${action.id} needs a canonical icon`).toBeDefined();
    }
    expect(component).toContain("<FeatureIcon");
  });

  it("uses no emoji", () => {
    const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
    expect(emoji.test(component)).toBe(false);
    for (const action of QUICK_ACTIONS) {
      expect(emoji.test(action.label)).toBe(false);
    }
  });

  it("gives every action its own accent, defined in CSS not inline", () => {
    const tones = QUICK_ACTIONS.map((action) => action.toneClass);
    expect(new Set(tones).size).toBe(QUICK_ACTION_COUNT);
    for (const tone of tones) {
      expect(css, `${tone} must be defined`).toContain(`.${tone} {`);
    }
  });

  it("never relies on colour alone", () => {
    // Every row carries a visible text label beside its glyph.
    expect(component).toContain("quick-actions-label");
    expect(component).toContain("{action.label}");
  });
});

// ---------------------------------------------------------------------------
// 3-8. Interaction
// ---------------------------------------------------------------------------

describe("open and close behaviour", () => {
  it("starts collapsed", () => {
    // Nothing is open until a route records itself as the one it was opened on.
    expect(component).toContain("useState<string | null>(null)");
  });

  it("closes on Escape and returns focus to the trigger", () => {
    expect(component).toContain('event.key !== "Escape"');
    expect(component).toContain("triggerRef.current?.focus()");
  });

  it("closes on an outside tap", () => {
    // pointerdown rather than click, so the menu is gone before the tap lands
    // on whatever was underneath it.
    expect(component).toContain('document.addEventListener("pointerdown", onPointerDown)');
    expect(component).toContain("containerRef.current?.contains(event.target as Node)");
  });

  it("closes on a downward swipe", () => {
    expect(component).toContain("onTouchStart");
    expect(component).toContain("endY - startY > 48");
  });

  it("closes when the route changes", () => {
    // DERIVED from the route rather than reset by an effect: the menu is open
    // only while the route it was opened on is still current. Navigating
    // therefore closes it by construction, with no cascading re-render and no
    // frame where a stale menu sits over the new page.
    expect(component).toContain("const open = openedOn !== null && openedOn === pathname");
    expect(component).toContain("setOpenedOn(pathname)");
  });

  it("closes before navigating rather than after", () => {
    // Otherwise the menu is seen collapsing over the page it just opened.
    const select = component.slice(component.indexOf("function selectAction"));
    const closeAt = select.indexOf("setOpenedOn(null)");
    const pushAt = select.indexOf("router.push");
    expect(closeAt).toBeGreaterThan(-1);
    expect(closeAt).toBeLessThan(pushAt);
  });

  it("does not persist open state", () => {
    expect(component).not.toContain("localStorage");
    expect(component).not.toContain("sessionStorage");
  });
});

// ---------------------------------------------------------------------------
// 10. One instance
// ---------------------------------------------------------------------------

describe("exactly one launcher exists", () => {
  it("is mounted once, in the shell", () => {
    expect(shell.match(/<QuickActionsLauncher \/>/g) ?? []).toHaveLength(1);
  });

  it("is hidden while a conversation is immersive", () => {
    // The composer owns the lower-right corner there.
    expect(shell).toContain("{immersive ? null : <QuickActionsLauncher />}");
  });

  it("is not mounted by any individual page", () => {
    // Five copies is how a launcher ends up on a screen nobody intended.
    for (const page of [
      "components/dashboard/dashboard-page.tsx",
      "components/friends/friends-page.tsx"
    ]) {
      // Named distinctly from the Home page's in-page QuickActionsHome rail,
      // which is a different component entirely -- a content row, not a
      // floating launcher.
      expect(read(page)).not.toContain("<QuickActionsLauncher");
    }
  });
});

// ---------------------------------------------------------------------------
// 11 + 12. Motion and positioning
// ---------------------------------------------------------------------------

describe("motion respects the user's preference", () => {
  it("reads the shared reduced-motion hook", () => {
    expect(component).toContain("useReducedMotion()");
    expect(component).toContain('data-reduced-motion={reducedMotion ? "true" : "false"}');
  });

  it("drops the stagger under reduced motion", () => {
    // A sequential delay is motion even without movement.
    const reduced = css.slice(css.indexOf('.quick-actions[data-reduced-motion="true"]'));
    expect(reduced.slice(0, 400)).toContain("transition-delay: 0ms");
    expect(reduced.slice(0, 400)).toContain("transform: none");
  });

  it("also honours the media query, not only the hook", () => {
    // The hook covers React state; the query covers first paint before it runs.
    const block = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(block.length).toBeGreaterThan(0);
  });
});

describe("positioning clears the navigation and the safe area", () => {
  const block = css.slice(css.indexOf(".quick-actions {"), css.indexOf(".quick-actions-stack"));

  it("sits above the bottom navigation and the home indicator", () => {
    expect(block).toContain("var(--mobile-nav-height)");
    expect(block).toContain("env(safe-area-inset-bottom, 0px)");
  });

  it("layers below navigation, dialogs, toasts and the camera", () => {
    // The launcher is the least important thing on screen. Anything that
    // opens over it must cover it -- especially the camera and any modal.
    const layer = /z-index:\s*(\d+)/.exec(block);
    expect(layer).not.toBeNull();
    const z = Number(layer?.[1]);
    expect(z).toBeLessThan(50); // bottom nav
    expect(z).toBeLessThan(60); // --layer-modal
    expect(z).toBeLessThan(120); // camera
  });

  it("lets taps through everywhere except the control itself", () => {
    expect(block).toContain("pointer-events: none");
    expect(css).toContain(".quick-actions-stack");
  });

  it("stays small when collapsed", () => {
    // 2.75rem x 3.75rem = 44 x 60px, inside the 42-48 x 58-68 target.
    const trigger = css.slice(css.indexOf(".quick-actions-trigger {"));
    const triggerBlock = trigger.slice(0, trigger.indexOf("}"));
    expect(triggerBlock).toContain("width: 2.75rem");
    expect(triggerBlock).toContain("height: 3.75rem");
  });

  it("keeps 44px touch targets on every action", () => {
    const action = css.slice(css.indexOf(".quick-actions-action {"));
    expect(action.slice(0, action.indexOf("}"))).toContain("min-height: 2.75rem");
  });
});

// ---------------------------------------------------------------------------
// 17. Short viewports
// ---------------------------------------------------------------------------

describe("short viewports fall back to scrolling", () => {
  it("scrolls only when the column genuinely cannot fit", () => {
    // Five rows fit on ordinary phones; scrolling is introduced only under a
    // height query, never by default.
    expect(css).toContain("@media (max-height: 620px)");
    const short = css.slice(css.indexOf("@media (max-height: 620px)"));
    expect(short.slice(0, 600)).toContain("overflow-y: auto");
  });

  it("hides the scrollbar on that narrow column", () => {
    const short = css.slice(css.indexOf("@media (max-height: 620px)"));
    expect(short.slice(0, 800)).toContain("scrollbar-width: none");
  });
});

// ---------------------------------------------------------------------------
// 13. Accessibility
// ---------------------------------------------------------------------------

describe("the launcher is operable without sight or a mouse", () => {
  it("exposes expanded state and the panel it controls", () => {
    expect(component).toContain("aria-expanded={open}");
    expect(component).toContain("aria-controls={panelId}");
  });

  it("names the trigger for both states", () => {
    expect(component).toContain('aria-label={open ? "Close quick actions" : "Open quick actions"}');
  });

  it("uses real buttons and links, not divs", () => {
    expect(component).toContain('<button');
    expect(component).toContain('type="button"');
    expect(component).toContain("<Link");
  });

  it("announces expansion to screen readers", () => {
    expect(component).toContain('role="status"');
    expect(component).toContain('aria-live="polite"');
  });

  it("keeps collapsed actions out of the tab order", () => {
    // Otherwise a keyboard user tabs through five invisible links.
    expect(component).toContain("tabIndex={open ? 0 : -1}");
    expect(component).toContain("aria-hidden={!open}");
  });

  it("shows a visible focus ring", () => {
    expect(component).toContain("focus-ring");
  });

  it("marks the action column as a menu", () => {
    expect(component).toContain('role="menu"');
    expect(component).toContain('role="menuitem"');
    expect(component).toContain('aria-label="Quick actions"');
  });
});

// ---------------------------------------------------------------------------
// 14 + 15. Camera behaviour is untouched
// ---------------------------------------------------------------------------

describe("Mad Cam behaviour is unchanged", () => {
  it("leaves the Home reselect gesture in place", () => {
    expect(shell).toContain("onHomeReselect={openCameraFromHome}");
    expect(shell).toContain("ORB_HOME_HREF");
  });

  it("keeps the camera mounted separately from the launcher, behind its flag", () => {
    // Mad Cam is paused (scope reduction), so the mount is additionally gated
    // on the server-resolved flag. The separation this test protects is
    // unchanged: the launcher never renders the composer itself.
    expect(shell).toContain("{madCamEnabled && cameraOpen ? <LazyCameraComposer onClose={closeCamera} /> : null}");
  });

  it("requests no camera or media permission", () => {
    expect(component).not.toContain("getUserMedia");
    expect(component).not.toContain("navigator.mediaDevices");
    expect(component).not.toContain("permissions.query");
  });
});

// ---------------------------------------------------------------------------
// 16. No backend cost
// ---------------------------------------------------------------------------

describe("the launcher costs nothing to render", () => {
  it("performs no data access", () => {
    for (const forbidden of ["supabase", "fetch(", "useQuery", "createClient", "from(\""]) {
      expect(component, `must not contain ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("does not prefetch the feature pages", () => {
    // Five route prefetches on every browsing screen, for a menu most sessions
    // never open.
    expect(component).toContain("prefetch={false}");
  });

  it("is route metadata and UI state only", () => {
    const routeModule = stripComments(read("lib/navigation/quick-actions.ts"));
    expect(routeModule).not.toContain("async");
    expect(routeModule).not.toContain("await");
  });
});

// ---------------------------------------------------------------------------
// 18. Haptics
// ---------------------------------------------------------------------------

describe("haptics degrade silently", () => {
  it("feature-detects before vibrating", () => {
    expect(haptics).toContain("export function hapticsSupported");
    expect(haptics).toContain('typeof (navigator as Navigator & { vibrate?: unknown }).vibrate === "function"');
  });

  it("never throws when unsupported or blocked", () => {
    // iOS Safari has no Vibration API at all, and some browsers throw when a
    // permissions policy blocks it.
    expect(haptics).toContain("if (!hapticsSupported()) return");
    expect(haptics).toContain("try {");
    expect(haptics).toContain("} catch {");
  });

  it("is the only place the app touches navigator.vibrate", () => {
    expect(component).not.toContain("navigator.vibrate");
    expect(component).toContain('haptic("tick")');
    expect(component).toContain('haptic("select")');
    expect(component).toContain('haptic("close")');
  });

  it("keeps every pattern short enough to read as a tick", () => {
    // A vibration long enough to feel like a buzz reads as an error.
    const durations = [...haptics.matchAll(/:\s*(\d+)\s*$/gm)].map((match) => Number(match[1]));
    for (const duration of durations) {
      expect(duration).toBeLessThanOrEqual(20);
    }
  });

  it("does not vibrate during ordinary scrolling", () => {
    expect(component).not.toContain("onScroll");
  });
});
