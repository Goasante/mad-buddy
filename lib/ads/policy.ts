export type AdFormat = "inline" | "anchor" | "interstitial";

export type AdPolicyInput = {
  pathname: string;
  format: AdFormat;
  /** Master switch resolved from Admin -> Features. */
  adsEnabled: boolean;
  /** Format-specific switch resolved from Admin -> Features. */
  formatEnabled: boolean;
  /** Canonical Mad Buddy Access projection. */
  adFree: boolean;
  /** True only when the required provider/client/slot configuration exists. */
  configured: boolean;
};

const ALWAYS_BLOCKED_PREFIXES = [
  "/login",
  "/signup",
  "/onboarding",
  "/maintenance",
  "/safe-arrival",
  "/billing",
  "/settings/access",
  "/admin",
  "/camera",
  "/call",
  "/video-call",
  // Google Publisher Policies prohibit AdSense on screens where private
  // communication is the primary focus. That includes the list as well as an
  // opened thread, so the whole Messages product stays clean on web.
  "/messages"
] as const;

/**
 * The first PWA rollout has exactly ONE wired display-ad surface: Home.
 *
 * Keeping this as an allowlist is deliberate. A new page does not become an ad
 * surface merely because somebody adds content to it or enables the master
 * switch; it must be explicitly reviewed and added here.
 */
const INLINE_ROUTES = new Set(["/dashboard"]);

export function isPwaInlineAdRoute(pathname: string): boolean {
  return INLINE_ROUTES.has(pathname);
}

export function isAdvertisingBlockedRoute(pathname: string): boolean {
  return ALWAYS_BLOCKED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

/**
 * One product rule for every PWA ad placement.
 *
 * Missing configuration, a disabled admin switch, Access ownership, or a
 * sensitive route all fail closed to NO AD. Placement components should ask
 * this function rather than growing their own route lists.
 */
export function shouldRequestAd(input: AdPolicyInput): boolean {
  if (!input.adsEnabled || !input.formatEnabled || input.adFree || !input.configured) return false;
  if (isAdvertisingBlockedRoute(input.pathname)) return false;

  // Initial web rollout is intentionally one responsive Home unit. This also
  // stops the shared provider from loading Google's script on every ordinary
  // app route when there is no ad placement there.
  if (input.format === "inline") return isPwaInlineAdRoute(input.pathname);

  // Anchor and interstitial are modelled for Admin control but have no live PWA
  // implementation yet. Returning false here makes those switches harmless
  // until a reviewed implementation changes this policy deliberately.
  return false;
}
