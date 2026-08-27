import type { Route } from "next";
import type { FeatureIconKey } from "@/lib/icons/feature-icons";

/**
 * Quick Actions: a compact launcher for the features that have no permanent
 * place in the bottom navigation.
 *
 * This module is deliberately pure. It holds route metadata and one visibility
 * rule and nothing else -- no data, no queries, no subscriptions -- so the
 * launcher costs essentially nothing to render and its behaviour can be tested
 * without mounting the app.
 *
 * The five actions each open the feature's CANONICAL route. There are no
 * context-dependent destinations: Plans opens Plans everywhere. An icon that
 * quietly means something different per screen is a thing users have to learn
 * page by page, and the first version should not ask that.
 */

export type QuickActionId = "moments" | "plans" | "events" | "safe_arrival" | "groups";

export type QuickAction = {
  id: QuickActionId;
  label: string;
  /** The feature's canonical route. Never a duplicate page. */
  href: Route;
  /** Key into the central icon mapping, so a glyph is defined in one place. */
  featureIcon: FeatureIconKey;
  /**
   * CSS custom property carrying this action's accent.
   *
   * A class rather than a literal colour: the values live beside every other
   * token in globals.css, and a themed surface can restate them without this
   * module knowing how.
   */
  toneClass: string;
};

/**
 * The launcher's contents, in display order.
 *
 * Ordered top-to-bottom as they appear when expanded. Moments sits nearest the
 * user's thumb because it is the most frequently opened of the five; Groups is
 * furthest because it is the most deliberate.
 *
 * Camera is deliberately ABSENT. Mad Cam is reached by the Home tab (tap to go
 * Home, tap again or double-tap to open the camera), and duplicating it here
 * would give one feature two competing entry points with different gestures.
 */
export const QUICK_ACTIONS: readonly QuickAction[] = [
  { id: "moments", label: "Moments", href: "/moments" as Route, featureIcon: "moments", toneClass: "qa-tone-moments" },
  { id: "plans", label: "Plans", href: "/plans" as Route, featureIcon: "plans", toneClass: "qa-tone-plans" },
  { id: "events", label: "Events", href: "/events" as Route, featureIcon: "events", toneClass: "qa-tone-events" },
  {
    id: "safe_arrival",
    label: "Safe Arrival",
    href: "/safe-arrival" as Route,
    featureIcon: "safeArrival",
    toneClass: "qa-tone-safe-arrival"
  },
  { id: "groups", label: "Groups", href: "/groups" as Route, featureIcon: "groups", toneClass: "qa-tone-groups" }
];

/**
 * Where Quick Actions appears.
 *
 * EVERYWHERE IN THE APP, except surfaces that genuinely cannot carry it. The
 * launcher is a shortcut to five features, and a shortcut that only exists on
 * four screens is one people never learn is there.
 *
 * This is a DENY list, reversing the earlier allow list. The tradeoff is real:
 * a future full-screen feature will show the launcher until somebody excludes
 * it. That is mitigated by excluding on the CHARACTERISTIC rather than by
 * naming routes one at a time -- anything full-screen or owning the lower-right
 * corner is listed below, so the rule describes a shape rather than an
 * inventory.
 *
 * Login, signup, onboarding, admin and billing need no entry here. They live
 * outside the (app) route group and never render the shell, so they cannot
 * show the launcher whatever this rule says.
 */

/**
 * Surfaces where the launcher does not belong.
 *
 * Each is here for a stated reason, not a preference:
 *
 *   /scan          A camera viewfinder. Full-bleed, and the shutter sits low
 *                  centre-right -- exactly where the pill would land.
 *   /safe-arrival  An active journey is a safety surface. Anything floating
 *                  over the share and check-in controls is unacceptable when
 *                  the whole point is reaching them quickly.
 *   /settings      Rows of toggles down the right edge -- exactly where the
 *                  pill sits. Reserving space at the FOOT of the page cannot
 *                  fix a control the user meets mid-scroll, and a shortcut to
 *                  five other features earns nothing on the screen where
 *                  somebody is deliberately configuring one thing.
 *
 * Mad Cam and the image editor need no entry: they render full-screen at
 * z-120 while the launcher sits at z-40, so they already cover it.
 *
 * An open conversation is handled in AppShell rather than here, because the
 * shell already knows it is immersive -- the message composer owns the
 * lower-right corner there.
 */
const EXCLUDED_SURFACES: readonly string[] = ["/scan", "/safe-arrival", "/settings"];

/**
 * Detail routes that keep their own corner.
 *
 * A person's profile, a single plan and a single group each have their own
 * primary action low on the screen. The parent list shows the launcher; the
 * detail view does not.
 */
const EXCLUDED_PREFIXES: readonly string[] = [
  "/friends/", // somebody's profile
  "/messages/", // a single conversation
  "/plans/",
  "/groups/",
  "/events/",
  "/scan/",
  "/safe-arrival/",
  // Every settings sub-page is the same focused configuration surface as its
  // parent -- /settings/glow-visibility is exactly where this matters most.
  "/settings/"
];

/**
 * Whether Quick Actions should render for this path.
 *
 * ONE rule, used by the single mounted instance in AppShell. Every surface
 * asking the same function is what keeps the launcher from appearing twice, or
 * from appearing somewhere nobody intended.
 */
export function showsQuickActions(pathname: string | null | undefined): boolean {
  if (!pathname) return false;

  // Query strings and hashes never change whether a surface can carry the
  // launcher, and `/plans?create=1` must not be treated as a different route.
  const path = pathname.split("?")[0].split("#")[0];

  if (EXCLUDED_SURFACES.includes(path)) return false;
  if (EXCLUDED_PREFIXES.some((prefix) => path.startsWith(prefix))) return false;

  // Everything else in the app. Routes outside the (app) group never reach
  // this function, because the shell that calls it is not rendered there.
  return path.startsWith("/");
}

/** Total actions, for tests and for the scroll fallback's height maths. */
export const QUICK_ACTION_COUNT = QUICK_ACTIONS.length;
