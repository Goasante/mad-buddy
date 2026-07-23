import { describe, expect, it } from "vitest";
import { buildContentSecurityPolicy, supabaseOriginFromEnv } from "@/lib/security/csp";

describe("supabaseOriginFromEnv", () => {
  it("extracts a clean origin from the project URL", () => {
    expect(supabaseOriginFromEnv("https://abc123.supabase.co")).toBe("https://abc123.supabase.co");
    expect(supabaseOriginFromEnv("https://abc123.supabase.co/some/path")).toBe(
      "https://abc123.supabase.co"
    );
  });

  it("returns null for missing or malformed URLs (secret-less CI builds)", () => {
    expect(supabaseOriginFromEnv(undefined)).toBeNull();
    expect(supabaseOriginFromEnv("")).toBeNull();
    expect(supabaseOriginFromEnv("not a url")).toBeNull();
  });
});

describe("buildContentSecurityPolicy", () => {
  const withSupabase = buildContentSecurityPolicy({
    supabaseOrigin: "https://abc123.supabase.co",
    mode: "report-only"
  });
  const withoutSupabase = buildContentSecurityPolicy({ supabaseOrigin: null, mode: "report-only" });

  it("includes the Supabase origin only where the app needs it (img + connect)", () => {
    expect(withSupabase).toContain("img-src 'self' data: https://abc123.supabase.co");
    expect(withSupabase).toContain("connect-src 'self' https://abc123.supabase.co");
    // Never in script-src, Supabase is data/auth, not a script host.
    expect(withSupabase).not.toContain("script-src 'self' 'unsafe-inline' https://abc123.supabase.co");
  });

  it("authorises the Realtime WebSocket, not just the https origin", () => {
    // CSP scheme matching does not let an https: source cover a wss:
    // connection. Without this entry, enforcing the policy would silently
    // break every Realtime subscription (waves, achievements, chat).
    expect(withSupabase).toContain("wss://abc123.supabase.co");
    const connectSrc = withSupabase.split("; ").find((directive) => directive.startsWith("connect-src"));
    expect(connectSrc).toContain("https://abc123.supabase.co");
    expect(connectSrc).toContain("wss://abc123.supabase.co");
  });

  it("allows the Google Analytics endpoints (tag + beacon)", () => {
    expect(withSupabase).toContain("script-src 'self' 'unsafe-inline' https://www.googletagmanager.com");
    expect(withSupabase).toContain("https://www.google-analytics.com");
  });

  it("adds the per-request nonce to script-src, keeping unsafe-inline as the legacy fallback", () => {
    const nonced = buildContentSecurityPolicy({
      supabaseOrigin: "https://abc123.supabase.co",
      mode: "enforce",
      nonce: "abc123NONCE"
    });
    const scriptSrc = nonced.split("; ").find((directive) => directive.startsWith("script-src"));
    // Nonce present so CSP2+ browsers ignore 'unsafe-inline'; both appear.
    expect(scriptSrc).toContain("'nonce-abc123NONCE'");
    expect(scriptSrc).toContain("'unsafe-inline'");
    // The nonce comes before the fallback so the intent reads clearly.
    expect(scriptSrc!.indexOf("'nonce-")).toBeLessThan(scriptSrc!.indexOf("'unsafe-inline'"));
  });

  it("omits the nonce token entirely when none is supplied", () => {
    expect(withSupabase).not.toContain("'nonce-");
  });

  it("degrades safely when Supabase env is absent", () => {
    expect(withoutSupabase).toContain("img-src 'self' data: https://www.google-analytics.com");
    expect(withoutSupabase).toContain("connect-src 'self' https://www.googletagmanager.com");
  });

  it("locks down framing, objects, base, and forms", () => {
    for (const directive of [
      "frame-ancestors 'none'",
      "frame-src 'none'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "default-src 'self'"
    ]) {
      expect(withSupabase).toContain(directive);
    }
  });

  it("allows only the same-origin push service worker", () => {
    expect(withSupabase).toContain("worker-src 'self'");
  });

  it("never contains unsafe-eval or a bare wildcard source", () => {
    expect(withSupabase).not.toContain("unsafe-eval");
    // A bare `*` source is forbidden; scoped subdomain wildcards like
    // https://*.google-analytics.com are fine.
    expect(withSupabase.split(/[;\s]+/)).not.toContain("*");
    expect(withSupabase).not.toContain("https://*;");
  });

  it("routes violation reports to the intake endpoint", () => {
    expect(withSupabase).toContain("report-uri /api/csp-report");
  });

  it("permits eval only when the dev flag is set, never by default", () => {
    expect(withSupabase).not.toContain("unsafe-eval");
    const dev = buildContentSecurityPolicy({ supabaseOrigin: null, mode: "report-only", allowDevEval: true });
    expect(dev).toContain("script-src 'self' 'unsafe-inline' 'unsafe-eval'");
  });

  it("omits upgrade-insecure-requests in report-only mode (spec: ignored + console error)", () => {
    expect(withSupabase).not.toContain("upgrade-insecure-requests");
    const enforced = buildContentSecurityPolicy({ supabaseOrigin: null, mode: "enforce" });
    expect(enforced).toContain("upgrade-insecure-requests");
  });
});
