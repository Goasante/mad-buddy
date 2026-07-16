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
  "/robots.txt",
  "/sitemap.xml",
  "/llms.txt"
]);

const PUBLIC_PREFIXES = [
  "/pricing",
  "/about",
  "/privacy",
  "/terms",
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/auth",
  "/admin/login",
  "/subscription-success",
  "/subscription-cancelled"
];

function matchesPrefix(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function isPublicPath(pathname: string) {
  if (PUBLIC_EXACT_PATHS.has(pathname)) {
    return true;
  }

  return PUBLIC_PREFIXES.some((prefix) => matchesPrefix(pathname, prefix));
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
