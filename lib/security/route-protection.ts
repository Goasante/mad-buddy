import { POST_LOGIN_ROUTE } from "@/lib/routes";

/**
 * Deny-by-default route protection (audit I-08).
 *
 * Previously proxy.ts kept a manually maintained list of PROTECTED prefixes,
 * which failed once already (/plans shipped unprotected). This module inverts
 * the model: every page route requires auth unless it is explicitly listed
 * as public below. A newly added route is now private by default.
 *
 * /api/* routes are passed through untouched: every API route performs its
 * own auth check and returns 401 JSON (redirecting an API caller to an HTML
 * login page would break clients), and the Paystack webhook authenticates
 * via HMAC signature rather than a session.
 */

const PUBLIC_EXACT_PATHS = new Set([
  "/",
  // PWA boot resources must stay public. Protecting either route makes the
  // browser receive the login page instead of a manifest/worker script.
  "/manifest.webmanifest",
  "/sw.js",
  "/robots.txt",
  "/sitemap.xml",
  "/llms.txt"
]);

const PUBLIC_PREFIXES = [
  "/pricing",
  "/about",
  "/faq",
  "/privacy",
  "/terms",
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/auth",
  "/admin/login",
  "/subscription-success",
  "/subscription-cancelled",
  // Shown while the app is paused; must be reachable signed out too.
  "/maintenance"
];

/**
 * Prefixes whose SUB-PATHS are public but whose bare path is not.
 *
 * `/invite/<token>` is an invite landing page a logged-out recipient must be
 * able to open (that is the entire point of an invite link), while `/invite`
 * itself is the authenticated "Invite a Muddy" screen and must stay private.
 * Listing "/invite" in PUBLIC_PREFIXES would wrongly expose both.
 */
const PUBLIC_SUBPATH_ONLY_PREFIXES = ["/invite"];

function matchesPrefix(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function matchesSubpathOnly(pathname: string, prefix: string) {
  return pathname.startsWith(`${prefix}/`) && pathname.length > prefix.length + 1;
}

/** Event share metadata must be reachable by social crawlers, while the Event
 * application itself remains authenticated and server-authorized. Only a UUID
 * share page and its preview image qualify; /events/top and every other child
 * stay protected by default. */
function isPublicEventSharePath(pathname: string) {
  return /^\/events\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?:\/preview)?$/i.test(pathname);
}

export function isPublicPath(pathname: string) {
  if (PUBLIC_EXACT_PATHS.has(pathname) || isPublicEventSharePath(pathname)) {
    return true;
  }

  if (PUBLIC_PREFIXES.some((prefix) => matchesPrefix(pathname, prefix))) {
    return true;
  }

  return PUBLIC_SUBPATH_ONLY_PREFIXES.some((prefix) => matchesSubpathOnly(pathname, prefix));
}

export function isApiPath(pathname: string) {
  return matchesPrefix(pathname, "/api");
}

/**
 * Returns the login route an unauthenticated request should be redirected
 * to, or null when the path needs no session (public page or self-guarding
 * API route).
 */
export function requiredLoginRedirect(pathname: string): "/login" | "/admin/login" | null {
  if (isApiPath(pathname) || isPublicPath(pathname)) {
    return null;
  }

  return matchesPrefix(pathname, "/admin") ? "/admin/login" : "/login";
}

/**
 * Routes that only make sense for a signed-OUT visitor. A user who already has
 * a session is sent to their dashboard instead of being shown the marketing
 * page or an empty login form.
 *
 * Deliberately EXCLUDED, each for a concrete reason:
 * - /reset-password: the recovery link signs the user in before they land here,
 *   so redirecting an authenticated visitor would make it impossible to ever
 *   set a new password.
 * - /auth/*: the OAuth callback completes sign-in itself and decides where to
 *   send the user (onboarding vs. their original destination).
 * - /admin/login: staff sign-in is a separate surface; a signed-in consumer
 *   account must still be able to reach it.
 * - /pricing, /about, /faq, /privacy, /terms: readable signed in or out.
 */
const GUEST_ONLY_EXACT_PATHS = new Set(["/"]);
const GUEST_ONLY_PREFIXES = ["/login", "/signup", "/forgot-password"];

export function authenticatedRedirect(pathname: string): string | null {
  if (isApiPath(pathname)) {
    return null;
  }

  if (GUEST_ONLY_EXACT_PATHS.has(pathname)) {
    return POST_LOGIN_ROUTE;
  }

  return GUEST_ONLY_PREFIXES.some((prefix) => matchesPrefix(pathname, prefix)) ? POST_LOGIN_ROUTE : null;
}
