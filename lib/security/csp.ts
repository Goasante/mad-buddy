/**
 * Content-Security-Policy builder (security-header hardening, audit §6/§13).
 *
 * STAGE: Report-Only. This policy is intentionally shipped as
 * Content-Security-Policy-Report-Only first, it cannot block anything, it
 * only reports would-be violations to /api/csp-report. Enforcement (and the
 * nonce upgrade replacing script-src 'unsafe-inline') is a documented
 * follow-up gated on a clean report window across the core user journeys.
 *
 * Every source below is evidence-backed from the read-only audit:
 * - Supabase project origin: browser auth client (connect-src) and avatar
 *   images from Storage public URLs (img-src).
 * - data: images: the sign-in card uses an inline data: SVG noise texture.
 * - 'unsafe-inline' script/style: the theme bootstrap script in
 *   app/layout.tsx and Next.js runtime inline scripts/styles. To be replaced
 *   by nonces before enforcement.
 * - The same-origin service worker is used only to display web-push events.
 */

export function supabaseOriginFromEnv(supabaseUrl: string | undefined): string | null {
  if (!supabaseUrl) {
    return null;
  }

  try {
    return new URL(supabaseUrl).origin;
  } catch {
    return null;
  }
}

export function buildContentSecurityPolicy(options: {
  supabaseOrigin: string | null;
  mode: "report-only" | "enforce";
  /**
   * Next.js dev tooling (HMR, eval source maps) requires eval. This must
   * only ever be true under `next dev`, production policies never include
   * 'unsafe-eval'.
   */
  allowDevEval?: boolean;
}): string {
  const supabase = options.supabaseOrigin;
  // Google Analytics (gtag.js): the tag loads from googletagmanager.com and
  // beacons to google-analytics.com (both endpoints + regional subdomains).
  const gtm = "https://www.googletagmanager.com";
  const ga = "https://www.google-analytics.com https://*.google-analytics.com https://*.analytics.google.com";
  const scriptSrc = options.allowDevEval
    ? `script-src 'self' 'unsafe-inline' 'unsafe-eval' ${gtm}`
    : `script-src 'self' 'unsafe-inline' ${gtm}`;

  const directives = [
    `default-src 'self'`,
    // Nonce upgrade planned before enforcement; see module comment.
    scriptSrc,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data:${supabase ? ` ${supabase}` : ""} ${ga}`,
    `connect-src 'self'${supabase ? ` ${supabase}` : ""} ${gtm} ${ga}`,
    `font-src 'self'`,
    `frame-src 'none'`,
    `frame-ancestors 'none'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `worker-src 'self'`,
    `media-src 'none'`,
    `manifest-src 'self'`
  ];

  // Per spec, upgrade-insecure-requests is ignored in report-only policies
  // and browsers log a console error about it, include it only when
  // enforcing.
  if (options.mode === "enforce") {
    directives.push(`upgrade-insecure-requests`);
  }

  directives.push(`report-uri /api/csp-report`);

  return directives.join("; ");
}
