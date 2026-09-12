/**
 * Web route → mobile route translation.
 *
 * Shared components are authored against the web route table and cannot know
 * which platform is rendering them. Most paths are identical on both sides;
 * these are the ones that genuinely differ, taken from the two real route
 * tables (app/(app)/**\/page.tsx and mobile/src/App.tsx) rather than assumed.
 *
 * Kept as data, and exported, so it is testable and so the divergence is
 * visible in one place instead of being spread through components. As the
 * shared-code migration converges the two apps, entries should be DELETED
 * here — a shrinking table is the measure of progress.
 */

/**
 * Exact-match renames. Longest-prefix rules live in PREFIX_MAP below.
 *
 * THE BAR FOR AN ENTRY HERE IS DELIBERATELY HIGH: the two routes must be the
 * SAME FEATURE under a different path. A rename qualifies. A different feature
 * that happens to be thematically adjacent does NOT.
 *
 * This matters more than it looks. An earlier draft mapped /linkr, /discover
 * and /hangout-mode onto /socialize, and /safety-center onto /safety, with the
 * reasoning "the closest equivalent rather than a dead route". That is exactly
 * backwards. Linkr and UpFor do not exist in the mobile app; sending someone
 * who tapped "Linkr" to Socialize does not give them Linkr, it teaches them
 * that Linkr looks like Socialize -- and it hides the gap from us too, which
 * defeats the point of this adapter. A route that lands on the SPA's "*"
 * catch-all is honest; a route that opens a different product is not.
 *
 * So: if the feature is missing on mobile, leave it unmapped.
 */
const EXACT_MAP: Readonly<Record<string, string>> = {
  // Home. Same surface, different path: the web orb points at /dashboard, the
  // SPA calls it /home.
  "/dashboard": "/home",
  // Same surface. "Muddies" is the product word; the web route kept the older
  // /friends spelling.
  "/friends": "/muddies",
  // Same surface. Web /meeting-pings is the SPA's /pings.
  "/meeting-pings": "/pings",
  // Same surface. mobile/src/screens/SafetyScreen.tsx is titled "Safe Arrival"
  // and calls /api/safe-arrival -- it IS the Safe Arrival screen, just routed
  // at /safety. (/safety-center is a DIFFERENT web page rendering
  // safety-center-page.tsx, and is deliberately absent below.)
  "/safe-arrival": "/safety",
  // Same surface. Access/billing is the SPA's subscription screen.
  "/settings/access": "/subscription"
};

/**
 * Web routes with NO mobile equivalent, listed so the gap is explicit and
 * testable rather than merely implied by absence.
 *
 * These deliberately fall through unmapped and reach the SPA's "*" catch-all.
 * When one of these features is actually built for mobile, add it to
 * EXACT_MAP and delete it here -- and the test that asserts it is unmapped
 * will fail, which is the reminder to do exactly that.
 */
export const MOBILE_ROUTES_NOT_BUILT: readonly string[] = [
  "/linkr",
  "/discover",
  "/hangout-mode",
  "/safety-center",
  "/drops",
  "/moments/new",
  "/chats-lab",
  "/profile-lab",
  /* Achievement notifications point at /badges, which exists on web
     (app/(app)/badges) and nowhere in the SPA. Missing from this list, it
     looked available to isBuiltForMobile, so an achievement row rendered as a
     tappable link that reached the catch-all. */
  "/badges",
  /* Admin is web-only and deliberately so -- it is an operator console, not a
     product surface, and there is no mobile route for it. The shared account
     menu also gates it behind showAdminLink, but that flag answers "may this
     person see Admin", not "does this platform have it". Both questions need
     answering, or an owner signing in on Android would tap through to the
     unavailable screen. */
  "/admin"
];

/**
 * Whether a destination exists in the mobile app.
 *
 * MIGRATION RULE: a shared surface must not RENDER a link to a route this
 * returns false for. Leaving the link visible is not a neutral gap -- the
 * SPA's catch-all is `<Navigate to="/home" replace />`, so tapping "Linkr" or
 * "UpFor" silently bounces to Home with no explanation, and `replace` means
 * the back button will not even return you. That reads as a broken app rather
 * than an absent feature.
 *
 * Hide the control, or render it disabled with an honest "not available in the
 * app yet". Do not let it fall through.
 *
 * Matches on the path prefix, so /profile-lab/edit is covered by the
 * /profile-lab entry.
 */
export function isBuiltForMobile(href: string): boolean {
  if (!href.startsWith("/")) return true; // external links are not ours to gate

  const splitAt = href.search(/[?#]/);
  const path = splitAt === -1 ? href : href.slice(0, splitAt);

  return !MOBILE_ROUTES_NOT_BUILT.some(
    (missing) => path === missing || path.startsWith(`${missing}/`)
  );
}

/**
 * Prefix rules, applied only when no exact match hits. Ordered longest-first
 * at lookup time so a more specific rule always wins.
 */
const PREFIX_MAP: ReadonlyArray<readonly [string, string]> = [
  // Same surface: a person's public profile. /friends/<username> on web is
  // /u/<username> on mobile.
  ["/friends/", "/u/"]
  // NOTE: /profile-lab is NOT mapped to /profile. It is a separate web-only
  // surface, not a renamed one -- see MOBILE_ROUTES_NOT_BUILT above.
];

/**
 * Next's object form of a destination: `href={{ pathname, query }}`.
 * components/scan/scan-page.tsx uses it to carry event/room ids.
 */
export type UrlObject = {
  pathname?: string | null;
  query?: Record<string, string | number | boolean | null | undefined> | null;
  hash?: string | null;
};

/**
 * Flattens Next's object destination into a plain path+query string, which is
 * what react-router's `to` takes.
 *
 * Undefined and null query values are dropped rather than serialised as the
 * strings "undefined"/"null" -- Next omits them, and a literal
 * "?event=undefined" would be a real bug on the receiving screen.
 */
export function urlObjectToPath(url: UrlObject): string {
  const pathname = url.pathname ?? "";
  const entries = Object.entries(url.query ?? {}).filter(
    ([, value]) => value !== undefined && value !== null
  );
  const query = new URLSearchParams(entries.map(([key, value]) => [key, String(value)])).toString();
  const hash = url.hash ? (url.hash.startsWith("#") ? url.hash : `#${url.hash}`) : "";
  return `${pathname}${query ? `?${query}` : ""}${hash}`;
}

/**
 * Translates a web path to its mobile equivalent.
 *
 * Query strings and hashes are preserved. An unmapped path is returned
 * unchanged — most routes match on both platforms, and one that does not exist
 * on mobile should reach the SPA's "*" catch-all rather than be silently
 * rewritten to something that merely looks plausible.
 */
export function toMobilePath(href: string): string {
  if (!href.startsWith("/")) return href;

  const splitAt = href.search(/[?#]/);
  const path = splitAt === -1 ? href : href.slice(0, splitAt);
  const suffix = splitAt === -1 ? "" : href.slice(splitAt);

  const exact = EXACT_MAP[path];
  if (exact) return exact + suffix;

  const prefixes = [...PREFIX_MAP].sort((a, b) => b[0].length - a[0].length);
  for (const [from, to] of prefixes) {
    if (path.startsWith(from)) return to + path.slice(from.length) + suffix;
  }

  return href;
}

/** Test/diagnostic view of the table. Never used to make product decisions. */
export function routeMapForTests() {
  return { exact: { ...EXACT_MAP }, prefix: PREFIX_MAP.map((entry) => [...entry]) };
}
