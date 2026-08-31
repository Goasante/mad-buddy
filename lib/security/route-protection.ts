import { POST_LOGIN_ROUTE } from "@/lib/routes";

/**
 * Deny-by-default route protection (audit I-08).
 *
 * Every page route requires auth unless it is explicitly listed as public
 * below. Newly added product routes therefore remain private by default.
 */

const PUBLIC_EXACT_PATHS = new Set([
  "/",
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
  "/support",
  "/safety",
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
  "/maintenance"
];

const PUBLIC_SUBPATH_ONLY_PREFIXES = ["/invite"];

function matchesPrefix(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function matchesSubpathOnly(pathname: string, prefix: string) {
  return pathname.startsWith(`${prefix}/`) && pathname.length > prefix.length + 1;
}

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

export function isDevelopmentOnlyPath(pathname: string): boolean {
  if (process.env.NODE_ENV !== "development") return false;
  return pathname === "/dev" || matchesPrefix(pathname, "/dev");
}

export function requiredLoginRedirect(pathname: string): "/login" | "/admin/login" | null {
  if (isApiPath(pathname) || isPublicPath(pathname) || isDevelopmentOnlyPath(pathname)) {
    return null;
  }

  return matchesPrefix(pathname, "/admin") ? "/admin/login" : "/login";
}

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
