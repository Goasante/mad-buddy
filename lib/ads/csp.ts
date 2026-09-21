function addSources(directive: string, sources: readonly string[]): string {
  const words = new Set(directive.split(/\s+/));
  for (const source of sources) words.add(source);
  return [...words].join(" ");
}

/**
 * AdSense's documented CSP integration is nonce-based strict CSP, not a rolling
 * host allowlist. Google's ad-serving domains change over time, so the trusted
 * nonce on the initial AdSense script must be allowed to propagate trust to
 * scripts it loads dynamically.
 *
 * This extension is applied only on the one currently-wired PWA ad route and
 * only when validated AdSense configuration exists. Everywhere else retains
 * Mad Buddy's ordinary stricter CSP unchanged.
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
        // Google's current strict-CSP guidance for AdSense. In modern browsers
        // strict-dynamic means the nonce is the trust root; `https:`/`http:`
        // are compatibility fallbacks rather than a replacement for the nonce.
        return addSources(directive, ["'unsafe-eval'", "'strict-dynamic'", "https:", "http:"]);
      }

      // The existing application policy constrains these resource classes.
      // AdSense may source them from changing Google-owned HTTPS origins, so a
      // fixed domain list is brittle. This relaxation is route-scoped by
      // proxy.ts to the approved Home ad surface, not app-wide.
      if (
        directive.startsWith("img-src ") ||
        directive.startsWith("connect-src ") ||
        directive.startsWith("frame-src ")
      ) {
        return addSources(directive, ["https:"]);
      }

      return directive;
    })
    .join("; ");
}
