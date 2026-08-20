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
 *   wss), avatar images from Storage (img-src), private Moment playback from
 *   signed Storage URLs (media-src).
 * - data: images: the sign-in card's inline SVG noise texture.
 * - blob: images/media: local previews of a file the user just chose, shown
 *   before upload (Event cover, avatar crop, Mad Cam, voice notes).
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
  const turnstile = "https://challenges.cloudflare.com";
  // https://www.google.com: gtag's Google Signals / cross-device linking
  // feature (only reachable now that the inline bootstrap script actually
  // carries our nonce — previously it was blocked before it could even try).
  const ga = "https://www.google-analytics.com https://*.google-analytics.com https://*.analytics.google.com https://www.google.com";
  // A nonce is added alongside 'unsafe-inline': nonce-aware browsers ignore
  // 'unsafe-inline' (CSP2+), so they only run scripts carrying this nonce,
  // while older browsers fall back to 'unsafe-inline' and still work.
  const noncePart = options.nonce ? ` 'nonce-${options.nonce}'` : "";
  const scriptSrc = options.allowDevEval
    ? `script-src 'self'${noncePart} 'unsafe-inline' 'unsafe-eval' ${gtm} ${turnstile}`
    : `script-src 'self'${noncePart} 'unsafe-inline' ${gtm} ${turnstile}`;

  const directives = [
    `default-src 'self'`,
    // Nonce upgrade planned before enforcement; see module comment.
    scriptSrc,
    `style-src 'self' 'unsafe-inline'`,
    // gtm here too: gtag.js falls back to an <img> beacon (not fetch/sendBeacon)
    // in some browsers/ad-blocker configurations, requested from
    // googletagmanager.com itself, not just the google-analytics.com domains.
    /* `blob:` is REQUIRED, not a loosening.
     *
     * Every local preview in the product -- the Event cover picker, the
     * profile avatar cropper, Mad Cam, voice notes -- shows the chosen file
     * through URL.createObjectURL before anything is uploaded. Without blob:
     * here the browser refuses to paint them, and the user sees a broken-image
     * icon inside a correctly-sized container. That is exactly the Event cover
     * bug this line fixes.
     *
     * It is low risk by construction: a blob: URL can only reference bytes
     * this document already created in memory. It cannot name a remote host,
     * so it grants no new exfiltration or injection surface the page did not
     * already have. */
    `img-src 'self' data: blob:${supabase ? ` ${supabase}` : ""} ${gtm} ${ga}`,
    // The Supabase origin is listed twice on purpose: once as https:// for
    // REST/auth, and once as wss:// for the Realtime socket. CSP scheme
    // matching does NOT let an https: source authorise a wss: connection, so
    // without the second entry every Realtime subscription breaks the moment
    // this policy moves from Report-Only to enforcing.
    // `data:` here is scoped to connect-src only (fetch/XHR/WebSocket targets,
    // never a remote host) — gtag.js's own bootstrap dynamically imports a
    // same-content `data:text/javascript;base64,...` module in some browsers,
    // which connect-src otherwise blocks even though the gtag.js script tag
    // itself is already trusted via the googletagmanager.com host source.
    `connect-src 'self' data:${supabase ? ` ${supabase} ${supabase.replace(/^https:/, "wss:")}` : ""} ${gtm} ${ga} ${turnstile}`,
    `font-src 'self'`,
    `frame-src ${turnstile}`,
    `frame-ancestors 'none'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `worker-src 'self'`,
    // blob: for the same reason as img-src: recorded audio and video are
    // played back from an object URL before they are ever uploaded.
    `media-src 'self' data: blob:${supabase ? ` ${supabase}` : ""}`,
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
