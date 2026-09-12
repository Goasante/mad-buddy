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
const css = read("app/quick-actions-replica.css");
const position = stripComments(read("lib/navigation/quick-actions-position.ts"));

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
    expect(showsQuickActions("/linkr")).toBe(false);
  });

  it("stays off focused configuration surfaces", () => {
    expect(showsQuickActions("/settings")).toBe(false);
    expect(showsQuickActions("/settings/glow-visibility")).toBe(false);
  });

  it("leaves detail routes their own corner", () => {
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
    const routeModule = stripComments(read("lib/navigation/quick-actions.ts"));
    expect(routeModule).toContain("EXCLUDED_SURFACES");
    expect(routeModule).toContain("EXCLUDED_PREFIXES");
  });

  it("needs no rule for routes outside the app shell", () => {
    const routeModule = stripComments(read("lib/navigation/quick-actions.ts"));
    expect(routeModule).not.toContain('"/login"');
    expect(routeModule).not.toContain('"/signup"');
    expect(routeModule).not.toContain('"/onboarding"');
  });
});

// ---------------------------------------------------------------------------
// Canonical destinations
// ---------------------------------------------------------------------------

describe("every action opens its canonical route", () => {
  it("carries only features that are actually live", () => {
    expect(QUICK_ACTIONS.map((action) => action.id)).toEqual([
      "plans",
      "events",
      "safe_arrival",
      "groups"
    ]);
  });

  it("offers no route that only redirects away", () => {
    const ids = QUICK_ACTIONS.map((action) => action.id);
    expect(ids, "a paused feature is back in Quick Actions").not.toContain("moments");
    expect(QUICK_ACTIONS.every((action) => action.href !== "/moments")).toBe(true);
  });

  it("points at the real feature pages, never a duplicate", () => {
    const routes = Object.fromEntries(QUICK_ACTIONS.map((action) => [action.id, action.href]));
    expect(routes.plans).toBe("/plans");
    expect(routes.events).toBe("/events");
    expect(routes.safe_arrival).toBe("/safe-arrival");
    expect(routes.groups).toBe("/groups");
  });

  it("never includes the camera", () => {
    const ids = QUICK_ACTIONS.map((action) => action.id).join(" ");
    expect(ids).not.toContain("camera");
    expect(component).not.toContain("CameraComposer");
    expect(component).not.toContain("getUserMedia");
  });

  it("opens the same destination regardless of the current page", () => {
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
    const globalsCss = read("app/globals.css");
    for (const tone of tones) {
      expect(globalsCss, `${tone} must be defined`).toContain(`.${tone} {`);
    }
  });

  it("never relies on colour alone", () => {
    // Every destination tile carries a visible text label beside its glyph.
    expect(component).toContain("quick-actions-sheet-label");
    expect(component).toContain("{action.label}");
  });

  it("uses a launcher glyph, never an up-chevron or arrow", () => {
    // The previous icon (ChevronUp) read as scroll-to-top/collapse, which is
    // not what this control does. LayoutGrid reads as "more", correctly.
    expect(component).toContain("LayoutGrid");
    expect(component).not.toContain("ChevronUp");
    expect(component).not.toMatch(/\bArrowUp\b/);
  });
});

// ---------------------------------------------------------------------------
// Open and close behaviour
// ---------------------------------------------------------------------------

describe("open and close behaviour", () => {
  it("starts collapsed", () => {
    expect(component).toContain('useState<string | null>(null)');
  });

  it("closes when the route changes", () => {
    // DERIVED from the route rather than reset by an effect: the sheet is
    // open only while the route it was opened on is still current.
    expect(component).toContain("const open = openedOn !== null && openedOn === pathname");
    expect(component).toContain("setOpenedOn(pathname)");
  });

  it("closes before navigating rather than after", () => {
    const select = component.slice(component.indexOf("function selectAction"));
    const closeAt = select.indexOf("setOpenedOn(null)");
    const pushAt = select.indexOf("router.push");
    expect(closeAt).toBeGreaterThan(-1);
    expect(closeAt).toBeLessThan(pushAt);
  });

  it("opens as the shared sheet primitive, not a bespoke overlay", () => {
    // Dismiss-on-back, focus restoration, safe-area padding and outside-tap
    // are all owned by Modal; the launcher does not reimplement them.
    expect(component).toContain('variant="sheet"');
    expect(component).toContain("<Modal");
  });

  it("persists only its position, never whether it is open", () => {
    // Position survives a reload by design (issue 8); the open/closed state
    // of the sheet itself must not, or a reload could land on a stray sheet.
    expect(component).not.toMatch(/localStorage[\s\S]*openedOn|openedOn[\s\S]*localStorage/);
    expect(position).toContain("localStorage");
  });
});

// ---------------------------------------------------------------------------
// One instance
// ---------------------------------------------------------------------------

describe("exactly one launcher exists", () => {
  it("is mounted once, in the shell", () => {
    expect(shell.match(/<QuickActionsLauncher \/>/g) ?? []).toHaveLength(1);
  });

  it("is hidden while a conversation is immersive", () => {
    expect(shell).toContain("{immersive ? null : <QuickActionsLauncher />}");
  });

  it("is not mounted by any individual page", () => {
    for (const page of [
      "components/dashboard/dashboard-page.tsx",
      "components/friends/friends-page.tsx"
    ]) {
      expect(read(page)).not.toContain("<QuickActionsLauncher");
    }
  });
});

// ---------------------------------------------------------------------------
// Motion and positioning
// ---------------------------------------------------------------------------

describe("motion respects the user's preference", () => {
  it("reads the shared reduced-motion hook", () => {
    expect(component).toContain("useReducedMotion()");
    expect(component).toContain('data-reduced-motion={reducedMotion ? "true" : "false"}');
  });

  it("drops the transition under reduced motion, in both signals", () => {
    expect(css).toContain('.quick-actions[data-reduced-motion="true"] .quick-actions-trigger');
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
  });
});

describe("positioning clears the navigation and the safe area", () => {
  it("reserves the bottom navigation's height and the device safe area", () => {
    // The reserve calculation lives in app-shell.tsx and consumes the
    // launcher's own --quick-actions-size, kept in sync in the stylesheet.
    expect(shell).toContain("--quick-actions-reserve");
    expect(shell).toContain("var(--mobile-nav-height)");
    // The bar moved to its own module so mobile can share it; the invariant
    // is unchanged, only its home.
    expect(stripComments(read("components/app-shell/mobile-nav.tsx"))).toContain("env(safe-area-inset-bottom,0px)");
  });

  it("computes its own vertical band clear of the header and the nav", () => {
    expect(component).toContain("function verticalBounds()");
    expect(component).toContain("--mobile-nav-height");
  });

  it("layers below navigation, dialogs, toasts and the camera", () => {
    const block = css.slice(css.indexOf(".quick-actions {"), css.indexOf(".quick-actions--unpositioned"));
    const layer = /z-index:\s*(\d+)/.exec(block);
    expect(layer).not.toBeNull();
    const z = Number(layer?.[1]);
    expect(z).toBeLessThan(50); // bottom nav
    expect(z).toBeLessThan(60); // --layer-modal
    expect(z).toBeLessThan(120); // camera
  });

  it("keeps a 44px+ touch target when collapsed", () => {
    const trigger = css.slice(css.indexOf(".quick-actions-trigger {"));
    const triggerBlock = trigger.slice(0, trigger.indexOf("}"));
    expect(triggerBlock).toContain("var(--quick-actions-size)");
    const sizeMatch = /--quick-actions-size:\s*([\d.]+)rem/.exec(css);
    expect(sizeMatch).not.toBeNull();
    expect(Number(sizeMatch?.[1]) * 16).toBeGreaterThanOrEqual(44);
  });

  it("gives every sheet destination a comfortable touch target", () => {
    const action = css.slice(css.indexOf(".quick-actions-sheet-action {"));
    const block = action.slice(0, action.indexOf("}"));
    const minHeight = /min-height:\s*([\d.]+)rem/.exec(block);
    expect(minHeight).not.toBeNull();
    expect(Number(minHeight?.[1]) * 16).toBeGreaterThanOrEqual(44);
  });
});

// ---------------------------------------------------------------------------
// Drag to reposition
// ---------------------------------------------------------------------------

describe("dragging repositions the launcher without opening it", () => {
  it("distinguishes a tap from a drag by real pointer movement", () => {
    expect(component).toContain("DRAG_THRESHOLD_PX");
    expect(component).toContain("onPointerDown");
    expect(component).toContain("onPointerMove");
    expect(component).toContain("onPointerUp");
  });

  it("only toggles the sheet when the gesture was not a drag", () => {
    const pointerUp = component.slice(component.indexOf("function onPointerUp"));
    const block = pointerUp.slice(0, pointerUp.indexOf("function toggle"));
    expect(block).toContain("if (!drag.isDrag)");
    expect(block).toContain("toggle()");
  });

  it("snaps to the nearer edge on release", () => {
    expect(component).toContain('nextEdge: QuickActionsEdge');
    expect(component).toContain("settleIntoBounds(nextEdge");
  });

  it("clamps the vertical position within the safe band on every move", () => {
    const move = component.slice(component.indexOf("function onPointerMove"));
    const block = move.slice(0, move.indexOf("function onPointerUp"));
    expect(block).toContain("clamp(");
    expect(block).toContain("verticalBounds()");
  });

  it("captures the pointer once a drag begins, so the gesture survives leaving the control", () => {
    expect(component).toContain("setPointerCapture");
    expect(component).toContain("releasePointerCapture");
  });
});

// ---------------------------------------------------------------------------
// Position persistence
// ---------------------------------------------------------------------------

describe("the chosen position is remembered locally", () => {
  it("stores only an edge and a clamped fraction, never a raw coordinate", () => {
    expect(position).toContain("QuickActionsEdge");
    expect(position).toContain("verticalFraction");
    expect(position).toMatch(/Math\.min\(1, Math\.max\(0, /);
  });

  it("never trusts a corrupt or foreign stored value", () => {
    expect(position).toContain("function isEdge(");
    expect(position).toContain('return value === "left" || value === "right"');
  });

  it("never throws when storage is unavailable", () => {
    expect(position).toContain("try {");
    expect(position).toContain("} catch {");
  });

  it("re-resolves against the current viewport on load, rather than trusting the stored pixels directly", () => {
    expect(component).toContain("loadQuickActionsPosition()");
    expect(component).toContain("verticalBounds()");
  });

  it("re-clamps on resize so a stored position cannot end up off-screen", () => {
    expect(component).toContain('window.addEventListener("resize"');
  });

  it("saves after a drag settles, not on every intermediate frame", () => {
    const pointerUp = component.slice(component.indexOf("function onPointerUp"));
    expect(pointerUp.slice(0, pointerUp.indexOf("function toggle"))).toContain("saveQuickActionsPosition(");
    const move = component.slice(component.indexOf("function onPointerMove"), component.indexOf("function onPointerUp"));
    expect(move).not.toContain("saveQuickActionsPosition(");
  });
});

// ---------------------------------------------------------------------------
// Accessibility
// ---------------------------------------------------------------------------

describe("the launcher is operable without sight or a mouse", () => {
  it("exposes expanded state and the panel it controls", () => {
    expect(component).toContain("aria-expanded={open}");
    expect(component).toContain("aria-controls={panelId}");
  });

  it("names the trigger meaningfully, never as a scroll control", () => {
    expect(component).toContain('aria-label="Quick actions"');
    expect(component.toLowerCase()).not.toContain("scroll to top");
  });

  it("uses real buttons and links, not divs", () => {
    expect(component).toContain('<button');
    expect(component).toContain('type="button"');
    expect(component).toContain("<Link");
  });

  it("keeps the sheet's destinations in a proper menu", () => {
    expect(component).toContain('role="menu"');
    expect(component).toContain('role="menuitem"');
  });

  it("is activatable by keyboard, not only by drag", () => {
    expect(component).toContain("onKeyDown");
    expect(component).toMatch(/event\.key === "Enter"/);
  });

  it("shows a visible focus ring", () => {
    expect(component).toContain("focus-ring");
  });
});

// ---------------------------------------------------------------------------
// Camera behaviour is untouched
// ---------------------------------------------------------------------------

describe("Mad Cam behaviour is unchanged", () => {
  it("leaves the Home reselect gesture in place", () => {
    expect(shell).toContain("onHomeReselect={openCameraFromHome}");
    expect(shell).toContain("ORB_HOME_HREF");
  });

  it("keeps the camera mounted separately from the launcher, behind its flag", () => {
    expect(shell).toContain("{madCamEnabled && cameraOpen ? <LazyCameraComposer onClose={closeCamera} /> : null}");
  });

  it("requests no camera or media permission", () => {
    expect(component).not.toContain("getUserMedia");
    expect(component).not.toContain("navigator.mediaDevices");
    expect(component).not.toContain("permissions.query");
  });
});

// ---------------------------------------------------------------------------
// No backend cost
// ---------------------------------------------------------------------------

describe("the launcher costs nothing to render", () => {
  it("performs no data access", () => {
    for (const forbidden of ["supabase", "fetch(", "useQuery", "createClient", "from(\""]) {
      expect(component, `must not contain ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("does not prefetch the feature pages", () => {
    expect(component).toContain("prefetch={false}");
  });

  it("is route metadata and UI state only", () => {
    const routeModule = stripComments(read("lib/navigation/quick-actions.ts"));
    expect(routeModule).not.toContain("async");
    expect(routeModule).not.toContain("await");
  });
});

// ---------------------------------------------------------------------------
// Haptics
// ---------------------------------------------------------------------------

describe("haptics degrade silently", () => {
  it("feature-detects before vibrating", () => {
    expect(haptics).toContain("export function hapticsSupported");
    expect(haptics).toContain('typeof (navigator as Navigator & { vibrate?: unknown }).vibrate === "function"');
  });

  it("never throws when unsupported or blocked", () => {
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
    const durations = [...haptics.matchAll(/:\s*(\d+)\s*$/gm)].map((match) => Number(match[1]));
    for (const duration of durations) {
      expect(duration).toBeLessThanOrEqual(20);
    }
  });

  it("does not vibrate during ordinary scrolling", () => {
    expect(component).not.toContain("onScroll");
  });

  it("confirms a completed drag with a tick, distinct from opening the sheet", () => {
    const pointerUp = component.slice(component.indexOf("function onPointerUp"));
    expect(pointerUp.slice(0, pointerUp.indexOf("function toggle"))).toContain('haptic("tick")');
  });
});
