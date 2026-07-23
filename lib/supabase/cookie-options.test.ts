import { afterEach, describe, expect, it, vi } from "vitest";
import { supabaseCookieOptions } from "@/lib/supabase/cookie-options";

function setNodeEnv(value: string) {
  vi.stubEnv("NODE_ENV", value);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("supabase auth cookie policy", () => {
  it("marks the session cookies Secure in production", () => {
    setNodeEnv("production");
    expect(supabaseCookieOptions().secure).toBe(true);
  });

  it("does not mark them Secure in development, http://localhost would drop them", () => {
    setNodeEnv("development");
    expect(supabaseCookieOptions().secure).toBe(false);
  });

  it("never sets httpOnly, the browser client must be able to refresh the session", () => {
    // @supabase/ssr's browser client rewrites these cookies through
    // document.cookie. Forcing HttpOnly here would silently break refresh.
    setNodeEnv("production");
    expect(supabaseCookieOptions()).not.toHaveProperty("httpOnly");
  });

  it("leaves name, path, sameSite, and maxAge to the library defaults", () => {
    // @supabase/ssr merges {...DEFAULT_COOKIE_OPTIONS, ...cookieOptions}, so
    // naming any of these here would override a working default — and
    // overriding `name` would invalidate every existing session.
    setNodeEnv("production");
    expect(Object.keys(supabaseCookieOptions())).toEqual(["secure"]);
  });

  it("never sets a cookie domain, so session cookies stay host-only", () => {
    setNodeEnv("production");
    expect(supabaseCookieOptions()).not.toHaveProperty("domain");
  });
});
