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
  "/video-call"
] as const;

/** Active one-to-one/group conversations stay clean during the first rollout. */
function isConversation(pathname: string): boolean {
  if (!pathname.startsWith("/messages")) return false;
  return pathname !== "/messages";
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
  if (ALWAYS_BLOCKED_PREFIXES.some((prefix) => input.pathname === prefix || input.pathname.startsWith(`${prefix}/`))) {
    return false;
  }
  if (isConversation(input.pathname)) return false;

  // Full-screen ads are deliberately narrower than passive formats. They are
  // disabled on messaging entirely and should only be invoked by named natural
  // break triggers even when this route-level policy says the page is eligible.
  if (input.format === "interstitial" && input.pathname.startsWith("/messages")) return false;

  return true;
}
