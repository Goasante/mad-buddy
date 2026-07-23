/**
 * One cookie policy shared by every @supabase/ssr client (browser client,
 * server client, and the proxy/middleware), so the three can never drift.
 *
 * What is deliberately NOT set here:
 *
 * - `httpOnly`: the library default is false and must stay false. The browser
 *   client reads and rewrites these same cookies through document.cookie to
 *   refresh the session, so making them HttpOnly would break refresh entirely.
 *   That is the documented @supabase/ssr architecture, not an oversight — the
 *   trade-off is that an XSS can read the session, which is why the CSP and
 *   the absence of user-controlled HTML are the real defence.
 * - `path`, `sameSite`, `maxAge`: left at the library defaults ("/", "lax",
 *   400 days). @supabase/ssr merges as
 *   `{...DEFAULT_COOKIE_OPTIONS, ...cookieOptions}`, so naming only `secure`
 *   keeps every other default intact — including the cookie name, which means
 *   this change cannot invalidate an existing session.
 * - `domain`: unset keeps the cookies host-only (mad-buddy.com), so they are
 *   never sent to a subdomain.
 */
export function supabaseCookieOptions() {
  return {
    // Add Secure in production only: local development is served over plain
    // http://localhost, where a Secure cookie would simply be dropped and
    // sign-in would break.
    secure: process.env.NODE_ENV === "production"
  };
}
