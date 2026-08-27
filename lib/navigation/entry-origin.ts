/**
 * Did this page get reached from somewhere else inside the app?
 *
 * The question a Back control has to answer before it acts. `router.back()` is
 * right whenever there is an in-app screen behind this one; on a cold entry --
 * a fresh tab, a notification, a shared link -- there is nothing behind it, and
 * going "back" would leave the product entirely.
 *
 * READ ONCE, ON MOUNT. `history.length` grows as somebody moves around, so
 * asking later answers a different question than "how did I get here". A fresh
 * tab opened straight onto a URL has a length of 1 and no same-origin referrer,
 * and that is the only case that needs a fallback destination.
 *
 * Extracted from the Circle detail screen, which established this convention
 * (see lib/navigation/circle-back-navigation.test.ts). Kept as one pure
 * function so a second surface reuses the rule rather than restating it — two
 * copies would eventually disagree about what a cold entry is.
 */
export function cameFromInsideApp(
  win: Pick<Window, "history" | "location"> | undefined = typeof window === "undefined"
    ? undefined
    : window,
  referrer: string = typeof document === "undefined" ? "" : document.referrer
): boolean {
  // Server render: no history to consult, so assume the safe fallback.
  if (!win) return false;
  return win.history.length > 1 || isSameOrigin(referrer, win.location.origin);
}

/**
 * Same origin, compared as an ORIGIN rather than as a string prefix.
 *
 * A bare `startsWith` is not an origin check: "https://mad-buddy.com.evil.test"
 * begins with "https://mad-buddy.com" and would be read as in-app. Nothing
 * dangerous follows from it here -- the worst case is a Back that calls
 * history.back() instead of pushing Home -- but a helper that other surfaces
 * will reuse should not be the place a look-alike host is treated as our own.
 */
function isSameOrigin(referrer: string, origin: string): boolean {
  if (!referrer) return false;
  try {
    return new URL(referrer).origin === origin;
  } catch {
    // Not a parseable URL: treat as external rather than guessing.
    return false;
  }
}

/**
 * What a visible Back control should actually do.
 *
 * ONE RULE, EVERY SURFACE. Back means "return to where I just was", so history
 * wins whenever there is real in-app history to unwind. A hardcoded parent is
 * only correct for a cold entry -- a fresh tab, a notification, a shared link
 * -- where there is nothing behind this screen at all.
 *
 * The defect this replaces: Back controls were plain links to an assumed
 * parent, so UpFor -> Linkr -> Back went Home rather than to UpFor, and
 * Profile -> Settings -> Privacy -> Back skipped Settings entirely. The parent
 * route is still useful, but as a FALLBACK rather than as the destination.
 */
export type BackDecision =
  /** Unwind real history: the previous in-app surface. */
  | { kind: "history" }
  /** Nothing behind this screen; go to the surface's safest parent. */
  | { kind: "fallback"; href: string };

export function resolveBack(input: {
  /** Whether this screen was reached from inside the app. */
  fromInsideApp: boolean;
  /** The surface's safest parent, used only on a cold entry. */
  fallbackHref: string;
}): BackDecision {
  return input.fromInsideApp ? { kind: "history" } : { kind: "fallback", href: input.fallbackHref };
}
