/**
 * Content-Security-Policy builder.
 *
 * STAGE: Enforced, nonce-based. proxy.ts generates a per-request nonce and
 * emits this as `Content-Security-Policy` (not Report-Only). script-src carries
 * `'nonce-<n>'`; the two app inline scripts (theme bootstrap, JSON-LD) and
 * every Next.js runtime script carry that nonce, so an injected inline script
 * without it is blocked.
 *
 * `'unsafe-inline'` remains in script-src ONLY as a CSP Level 2 fallback: the
 * spec says a browser that understands nonces MUST ignore 'unsafe-inline' when
 * a nonce is present, so modern browsers get full inline protection while very
 * old ones still run the page. This is the standard backward-compatible strict
 * CSP pattern, not a loophole.
 *
 * Sources, each evidence-backed:
 * - Supabase origin: auth/REST (connect-src https), Realtime (connect-src
 *   wss), avatar images from Storage (img-src).
 * - data: images: the sign-in card's inline SVG noise texture.
 * - style-src 'unsafe-inline': Tailwind/Next inject inline styles; style
 *   injection is far lower risk than script injection and nonce-ing every
 *   style is impractical, so this stays.
 * - Google Analytics tag + beacon endpoints.
 * - The same-origin service worker (web-push display only).
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
  /** Per-request nonce (from proxy.ts). Present in enforce mode. */
  nonce?: string;
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
  // A nonce is added alongside 'unsafe-inline': nonce-aware browsers ignore
  // 'unsafe-inline' (CSP2+), so they only run scripts carrying this nonce,
  // while older browsers fall back to 'unsafe-inline' and still work.
  const noncePart = options.nonce ? ` 'nonce-${options.nonce}'` : "";
  const scriptSrc = options.allowDevEval
    ? `script-src 'self'${noncePart} 'unsafe-inline' 'unsafe-eval' ${gtm}`
    : `script-src 'self'${noncePart} 'unsafe-inline' ${gtm}`;

  const directives = [
    `default-src 'self'`,
    // Nonce upgrade planned before enforcement; see module comment.
    scriptSrc,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data:${supabase ? ` ${supabase}` : ""} ${ga}`,
    // The Supabase origin is listed twice on purpose: once as https:// for
    // REST/auth, and once as wss:// for the Realtime socket. CSP scheme
    // matching does NOT let an https: source authorise a wss: connection, so
    // without the second entry every Realtime subscription breaks the moment
    // this policy moves from Report-Only to enforcing.
    `connect-src 'self'${supabase ? ` ${supabase} ${supabase.replace(/^https:/, "wss:")}` : ""} ${gtm} ${ga}`,
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
