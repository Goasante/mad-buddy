import { describe, expect, it } from "vitest";

import {
  PRODUCTION_PROJECT_REF,
  evaluateSafety,
  parseProjectRef,
  type SafetyInput
} from "./safety";

const STAGING_URL = "https://abcdefghijklmnopqrst.supabase.co";

function input(overrides: Partial<SafetyInput> = {}): SafetyInput {
  return {
    supabaseUrl: STAGING_URL,
    serviceRoleKey: "service-role-placeholder",
    optIn: "YES",
    password: "placeholder",
    apply: false,
    ...overrides
  };
}

describe("parseProjectRef", () => {
  it("extracts the ref from a hosted Supabase URL", () => {
    expect(parseProjectRef(STAGING_URL)).toBe("abcdefghijklmnopqrst");
  });

  it("recognises local stacks as a named target rather than a ref", () => {
    expect(parseProjectRef("http://127.0.0.1:54321")).toBe("local");
    expect(parseProjectRef("http://localhost:55321")).toBe("local");
  });

  it("returns null for anything it cannot confidently parse", () => {
    // Refusing on null is what makes an unknown target safe.
    expect(parseProjectRef(undefined)).toBeNull();
    expect(parseProjectRef("")).toBeNull();
    expect(parseProjectRef("not-a-url")).toBeNull();
    expect(parseProjectRef("https://example.com")).toBeNull();
    expect(parseProjectRef("https://short.supabase.co")).toBeNull();
  });
});

describe("evaluateSafety", () => {
  it("approves a staging project with the opt-in flag", () => {
    const result = evaluateSafety(input());
    expect(result.ok).toBe(true);
  });

  it("HARD-REFUSES the production project ref", () => {
    const result = evaluateSafety(
      input({ supabaseUrl: `https://${PRODUCTION_PROJECT_REF}.supabase.co` })
    );
    expect(result).toMatchObject({ ok: false, code: "production_ref" });
  });

  it("refuses production even when every other signal says go", () => {
    // The guard must not be defeatable by setting the opt-in flag, which is
    // exactly the mistake a hurried operator would make.
    const result = evaluateSafety(
      input({
        supabaseUrl: `https://${PRODUCTION_PROJECT_REF}.supabase.co`,
        optIn: "YES",
        apply: true
      })
    );
    expect(result).toMatchObject({ ok: false, code: "production_ref" });
  });

  it("refuses when the staging opt-in flag is missing or not exactly YES", () => {
    expect(evaluateSafety(input({ optIn: undefined }))).toMatchObject({
      ok: false,
      code: "missing_opt_in"
    });
    expect(evaluateSafety(input({ optIn: "yes" }))).toMatchObject({
      ok: false,
      code: "missing_opt_in"
    });
    expect(evaluateSafety(input({ optIn: "true" }))).toMatchObject({
      ok: false,
      code: "missing_opt_in"
    });
  });

  it("refuses an unknown or unparseable target", () => {
    expect(evaluateSafety(input({ supabaseUrl: undefined }))).toMatchObject({
      ok: false,
      code: "missing_url"
    });
    expect(evaluateSafety(input({ supabaseUrl: "https://example.com" }))).toMatchObject({
      ok: false,
      code: "unparseable_url"
    });
  });

  it("refuses --apply without a service-role key", () => {
    expect(evaluateSafety(input({ apply: true, serviceRoleKey: undefined }))).toMatchObject({
      ok: false,
      code: "missing_service_role"
    });
  });

  it("refuses --apply without the staging password", () => {
    expect(evaluateSafety(input({ apply: true, password: undefined }))).toMatchObject({
      ok: false,
      code: "missing_password"
    });
  });

  it("allows a dry run without any credentials", () => {
    // The plan must be reviewable before the owner issues keys.
    const result = evaluateSafety(
      input({ apply: false, serviceRoleKey: undefined, password: undefined })
    );
    expect(result.ok).toBe(true);
  });

  it("never returns key material in its result", () => {
    const result = evaluateSafety(input({ serviceRoleKey: "super-secret-value" }));
    expect(JSON.stringify(result)).not.toContain("super-secret-value");
  });
});
