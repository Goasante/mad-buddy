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
    expect(withSupabase).toContain("script-src 'self' 'unsafe-inline';");
  });

  it("degrades safely when Supabase env is absent", () => {
    expect(withoutSupabase).toContain("img-src 'self' data:;");
    expect(withoutSupabase).toContain("connect-src 'self';");
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

  it("never contains unsafe-eval or wildcard sources", () => {
    expect(withSupabase).not.toContain("unsafe-eval");
    expect(withSupabase).not.toMatch(/-src[^;]*\*/);
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
