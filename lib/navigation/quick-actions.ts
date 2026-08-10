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
 * The surfaces that show Quick Actions.
 *
 * An ALLOW list, not a deny list, and that choice matters. A deny list means
 * every future route shows the launcher until someone remembers to exclude it
 * -- so a new full-screen editor would ship with a floating pill over it. With
 * an allow list the default for anything new is "hidden", which is the safe
 * direction to be wrong in.
 *
 * These are the browsing surfaces: places where a user is looking around
 * rather than completing a task.
 */
export const QUICK_ACTION_SURFACES: readonly string[] = [
  "/dashboard", // Home
  "/friends", // Muddies
  "/discover", // Linkr
  "/hangout-mode" // UpFor
];

/**
 * Detail and task routes that must stay clear even though their parent is a
 * listed surface.
 *
 * `/friends` shows the launcher, but `/friends/someone` is a profile with its
 * own actions; `/discover` shows it, but a nested flow does not. Checked before
 * the allow list so a nested path can never inherit visibility from its parent.
 */
const NESTED_EXCLUSIONS: readonly string[] = [
  "/friends/", // a specific Muddy's profile
  "/discover/",
  "/hangout-mode/"
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

  // Query strings and hashes never change whether a surface is a browsing
  // surface, and `/plans?create=1` must not be treated as a different route.
  const path = pathname.split("?")[0].split("#")[0];

  if (NESTED_EXCLUSIONS.some((prefix) => path.startsWith(prefix))) return false;

  // Exact match only. A prefix match would show the launcher on every child of
  // a listed surface, which is precisely what the exclusions above exist to
  // prevent -- and would make the two rules fight each other.
  return QUICK_ACTION_SURFACES.includes(path);
}

/** Total actions, for tests and for the scroll fallback's height maths. */
export const QUICK_ACTION_COUNT = QUICK_ACTIONS.length;
