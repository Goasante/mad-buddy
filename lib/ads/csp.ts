const GOOGLE_AD_SCRIPT = "https://pagead2.googlesyndication.com";
const GOOGLE_AD_NETWORK = [
  "https://*.googlesyndication.com",
  "https://*.doubleclick.net",
  "https://*.google.com",
  "https://www.google.com"
] as const;

function addSources(directive: string, sources: readonly string[]): string {
  const words = new Set(directive.split(/\s+/));
  for (const source of sources) words.add(source);
  return [...words].join(" ");
}

/**
 * Add only the network permissions needed by the PWA ad transport.
 *
 * The base CSP stays strict on deployments that have no approved AdSense
 * configuration. This function is intentionally transport-only: whether an
 * ad MAY be requested is still decided separately by Admin flags, route policy
 * and the user's Access entitlement.
 */
export function extendContentSecurityPolicyForGoogleAds(
  policy: string,
  enabled: boolean
): string {
  if (!enabled) return policy;

  return policy
    .split("; ")
    .map((directive) => {
      if (directive.startsWith("script-src ")) {
        return addSources(directive, [GOOGLE_AD_SCRIPT]);
      }
      if (
        directive.startsWith("img-src ") ||
        directive.startsWith("connect-src ") ||
        directive.startsWith("frame-src ")
      ) {
        return addSources(directive, GOOGLE_AD_NETWORK);
      }
      return directive;
    })
    .join("; ");
}
