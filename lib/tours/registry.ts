/**
 * Authoring registry: the tourable UI targets and the routes an admin may pick
 * from. Exists purely to make authoring and validation possible without an
 * admin memorising `data-tour-id` values or hand-typing paths.
 *
 * This is NOT a second source of truth for the app's routes or layout. A target
 * listed here is a *claim* that some component renders that data-tour-id;
 * publish validation still scrapes source to verify it, and the consumer engine
 * still degrades a missing target to a plain card. Adding a target here without
 * adding the attribute in the component gets flagged, not silently shipped.
 */

export type TourRouteOption = {
  path: string;
  label: string;
};

/**
 * Routes an admin can send a step to. Paths must match the canonical app routes;
 * anything not listed can still be typed manually and is validated as an
 * internal path, but the picker keeps the common cases correct by construction.
 */
export const TOUR_ROUTES: TourRouteOption[] = [
  { path: "/dashboard", label: "Home" },
  { path: "/friends", label: "Muddies" },
  { path: "/notifications", label: "Pulse" },
  { path: "/messages", label: "Messages" },
  { path: "/plans", label: "Plans" },
  { path: "/hangout-mode", label: "Hangout Mode" },
  { path: "/discover", label: "Socialize" },
  { path: "/safe-arrival", label: "Safe Arrival" },
  { path: "/moments", label: "Moments" },
  { path: "/events", label: "Events" },
  { path: "/groups", label: "Groups" },
  { path: "/profile", label: "Profile" },
  { path: "/settings", label: "Settings" },
  { path: "/settings/appearance/wallpaper", label: "Wallpaper" },
  { path: "/upgrade", label: "Plans and pricing" }
];

export type TourTargetOption = {
  id: string;
  label: string;
  /** Where this element lives, so the editor can suggest a matching route. */
  route: string;
  description: string;
};

/**
 * Spotlightable elements, each backed by a real `data-tour-id` in the app.
 * Keep this list honest: if an entry is removed from the UI, publish validation
 * will start reporting it as unverified.
 */
export const TOUR_TARGETS: TourTargetOption[] = [
  {
    id: "home-nearby",
    label: "Nearby Muddies",
    route: "/dashboard",
    description: "The Home section showing which approved Muddies are close by."
  },
  {
    id: "socialize-activation",
    label: "Socialize activation",
    route: "/discover",
    description: "The avatar at the centre of the radar that turns Socialize on."
  },
  {
    id: "socialize-radar",
    label: "Socialize radar",
    route: "/discover",
    description: "The proximity radar where nearby people appear."
  },
  { id: "nav-dashboard", label: "Home tab", route: "/dashboard", description: "Bottom navigation: Home." },
  { id: "nav-friends", label: "Muddies tab", route: "/friends", description: "Bottom navigation: Muddies." },
  { id: "nav-notifications", label: "Pulse tab", route: "/notifications", description: "Bottom navigation: Pulse." },
  { id: "nav-messages", label: "Messages tab", route: "/messages", description: "Bottom navigation: Messages." },
  { id: "nav-plans", label: "Plans tab", route: "/plans", description: "Bottom navigation: Plans." },
  { id: "nav-hangout-mode", label: "Hangout tab", route: "/hangout-mode", description: "Navigation: Hangout Mode." },
  { id: "nav-discover", label: "Socialize tab", route: "/discover", description: "Navigation: Socialize." }
];

export function findTarget(id: string): TourTargetOption | undefined {
  return TOUR_TARGETS.find((target) => target.id === id);
}

export function findRoute(path: string): TourRouteOption | undefined {
  return TOUR_ROUTES.find((route) => route.path === path);
}

/** Friendly label for a stored target id, falling back to the raw id. */
export function targetLabel(id: string | null): string | null {
  if (!id) return null;
  return findTarget(id)?.label ?? id;
}

export function isKnownRoute(path: string): boolean {
  return TOUR_ROUTES.some((route) => route.path === path);
}
