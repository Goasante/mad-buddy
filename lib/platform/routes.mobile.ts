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

/** Exact-match redirects. Longest-prefix rules live in PREFIX_MAP below. */
const EXACT_MAP: Readonly<Record<string, string>> = {
  // Home. The web orb points at /dashboard; the SPA calls it /home.
  "/dashboard": "/home",
  // "Muddies" is the product word; the web route kept the older /friends.
  "/friends": "/muddies",
  // Discovery. Web has both /discover and /linkr; the SPA has one screen.
  "/discover": "/socialize",
  "/linkr": "/socialize",
  // UpFor lives at /hangout-mode on web; the SPA has no dedicated screen yet,
  // so it lands on the closest equivalent rather than a dead route.
  "/hangout-mode": "/socialize",
  // Meeting pings.
  "/meeting-pings": "/pings",
  // Safety.
  "/safe-arrival": "/safety",
  "/safety-center": "/safety",
  // Access/billing.
  "/settings/access": "/subscription",
  // Notification preferences.
  "/settings/notifications": "/settings/notifications"
};

/**
 * Prefix rules, applied only when no exact match hits. Ordered longest-first
 * at lookup time so a more specific rule always wins.
 */
const PREFIX_MAP: ReadonlyArray<readonly [string, string]> = [
  // A person's profile: /friends/<username> → /u/<username>.
  ["/friends/", "/u/"],
  // Profile-lab is a web-only surface; send it to the plain profile screen.
  ["/profile-lab", "/profile"]
];

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
