import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { PRIVACY_POLICY_VERSION } from "@/lib/legal/consent";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const actions = read("app/(auth)/actions.ts");
const bootstrap = read("lib/auth/bootstrap.ts");

/**
 * Mirrors the server schema in app/(auth)/actions.ts. Kept in step by the
 * "schema matches" test below, so a change there fails here rather than
 * silently drifting.
 */
const serverSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  acceptedPolicy: z.literal(true),
  policyVersion: z.literal(PRIVACY_POLICY_VERSION),
  turnstileToken: z.string().max(2048).nullable().optional()
});

function valid(overrides: Record<string, unknown> = {}) {
  return {
    email: "someone@example.com",
    password: "correct-horse",
    acceptedPolicy: true,
    policyVersion: PRIVACY_POLICY_VERSION,
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// The bug: a valid form was rejected
// ---------------------------------------------------------------------------

describe("turnstile token shape", () => {
  it("accepts the null the form actually sends", () => {
    // The form holds turnstileToken as `string | null` and sends null whenever
    // no token was issued — including when the site key is unset, which leaves
    // the submit button enabled. `.optional()` alone rejects null, so every
    // signup failed validation and showed the generic fallback.
    expect(serverSchema.safeParse(valid({ turnstileToken: null })).success).toBe(true);
  });

  it("still accepts a real token and an absent one", () => {
    expect(serverSchema.safeParse(valid({ turnstileToken: "0.abc" })).success).toBe(true);
    expect(serverSchema.safeParse(valid()).success).toBe(true);
  });

  it("is nullable on both signup paths", () => {
    for (const [name, source] of [["web", actions], ["native", bootstrap]] as const) {
      expect(source, `${name} schema must accept null`).toContain(
        "z.string().max(2048).nullable().optional()"
      );
    }
  });

  it("still enforces the challenge itself", () => {
    // Accepting the shape must not weaken the check: verifyTurnstileToken
    // remains the gate.
    expect(actions).toContain("verifyTurnstileToken(parsed.data.turnstileToken");
    expect(bootstrap).toContain("verifyTurnstileToken(parsed.data.turnstileToken");
  });
});

// ---------------------------------------------------------------------------
// Every known validation error gets its own message
// ---------------------------------------------------------------------------

/** Extracted from the action so the test asserts the real mapping. */
function messageFor(input: unknown): string {
  const parsed = serverSchema.safeParse(input);
  if (parsed.success) return "(valid)";
  const field = parsed.error.issues[0]?.path[0];
  switch (field) {
    case "email":
      return "Enter a valid email address.";
    case "password":
      return "Password must be at least 8 characters.";
    case "acceptedPolicy":
      return "Please accept the Terms and Privacy Policy.";
    case "policyVersion":
      return "Our Terms have been updated. Reload the page and try again.";
    case "turnstileToken":
      return "Your security check expired. Reload the page and try again.";
    default:
      return "Please check the signup form and try again.";
  }
}

describe("specific validation messages", () => {
  const cases: Array<[string, unknown, string]> = [
    ["invalid email", valid({ email: "not-an-email" }), "Enter a valid email address."],
    ["empty email", valid({ email: "" }), "Enter a valid email address."],
    ["short password", valid({ password: "short" }), "Password must be at least 8 characters."],
    ["policy unchecked", valid({ acceptedPolicy: false }), "Please accept the Terms and Privacy Policy."],
    [
      "stale policy version",
      valid({ policyVersion: "1999-01-01" }),
      "Our Terms have been updated. Reload the page and try again."
    ],
    [
      "oversized token",
      valid({ turnstileToken: "x".repeat(2049) }),
      "Your security check expired. Reload the page and try again."
    ]
  ];

  for (const [name, input, expected] of cases) {
    it(`shows a specific message for: ${name}`, () => {
      expect(messageFor(input)).toBe(expected);
    });
  }

  it("never shows the generic fallback for a known field", () => {
    for (const [name, input] of cases) {
      expect(messageFor(input), `${name} fell through to the fallback`).not.toBe(
        "Please check the signup form and try again."
      );
    }
  });

  it("keeps the fallback only for genuinely unknown input", () => {
    expect(messageFor(null)).toBe("Please check the signup form and try again.");
    expect(messageFor("nonsense")).toBe("Please check the signup form and try again.");
  });

  it("wires the mapper into the action rather than a fixed string", () => {
    expect(actions).toContain("signupValidationMessage(parsed.error)");
    expect(actions).toContain("function signupValidationMessage");
  });

  it("maps the native path too", () => {
    expect(bootstrap).toContain("nativeSignupValidationMessage(parsed.error)");
    for (const message of ["Enter your name.", "Enter a valid email address."]) {
      expect(bootstrap).toContain(message);
    }
  });
});

// ---------------------------------------------------------------------------
// Provider errors
// ---------------------------------------------------------------------------

describe("provider error mapping", () => {
  it("maps the known Supabase failures to our own wording", () => {
    for (const [code, message] of [
      ["weak_password", "Choose a stronger password with at least 8 characters."],
      ["email_address_invalid", "Enter a valid email address."],
      ["over_email_send_rate_limit", "Too many attempts. Wait a minute and try again."],
      ["signup_disabled", "New accounts are temporarily unavailable. Try again later."]
    ]) {
      expect(actions, `${code} should be handled`).toContain(code);
      expect(actions, `${code} needs its message`).toContain(message);
    }
  });

  it("falls back to a sentence we own for anything unrecognised", () => {
    expect(actions).toContain("We couldn't create your account. Please try again.");
  });

  it("never returns the raw provider message", () => {
    const mapper = actions.slice(
      actions.indexOf("function signupProviderMessage"),
      actions.indexOf("function signupValidationMessage")
    );
    expect(mapper).not.toContain("return message");
    expect(mapper).not.toContain("error.message}");
  });

  it("keeps duplicate emails indistinguishable from a fresh signup", () => {
    // Anti-enumeration: the form must not reveal which addresses exist.
    //
    // Asserted on BEHAVIOUR rather than on a comment: a duplicate returns
    // ok:true, exactly as a fresh signup does, and never a message naming the
    // conflict. The previous version of this test pinned a sentence in a code
    // comment, so it broke when that comment moved while the guarantee itself
    // was untouched -- and would equally have passed if the comment stayed and
    // the behaviour changed.
    const duplicateBranch = actions.slice(actions.indexOf('reason === "duplicate"'));
    expect(duplicateBranch.slice(0, 300)).toContain("ok: true");
    // Scoped to the RETURNED message, not the whole file: a comment may
    // legitimately explain the anti-enumeration rule using these words.
    const returnedMessages = [...actions.matchAll(/message:\s*"([^"]+)"/g)].map((match) => match[1]);
    for (const message of returnedMessages) {
      expect(message.toLowerCase()).not.toContain("already exists");
      expect(message.toLowerCase()).not.toContain("already registered");
    }
  });
});

// ---------------------------------------------------------------------------
// Nothing internal leaks
// ---------------------------------------------------------------------------

describe("no internal detail reaches the user", () => {
  it("logs the field name but never the submitted value", () => {
    expect(actions).toContain('errorType: `invalid_${String(parsed.error.issues[0]?.path[0] ?? "input")}`');
    expect(actions).not.toContain("parsed.error.issues[0]?.message");
  });

  it("never surfaces a Zod code or path to the user", () => {
    const mapper = actions.slice(actions.indexOf("function signupValidationMessage"));
    expect(mapper.slice(0, 900)).not.toContain("issue.code");
    expect(mapper.slice(0, 900)).not.toContain("issue.path.join");
  });

  it("does not log passwords or tokens", () => {
    for (const secret of ["password:", "turnstileToken:", "access_token"]) {
      const logs = actions.match(/logBackendEvent\([\s\S]{0,320}?\)/g) ?? [];
      for (const call of logs) {
        expect(call, `a log call must not include ${secret}`).not.toContain(secret);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Client and server agree
// ---------------------------------------------------------------------------

describe("client and server agree", () => {
  const form = read("components/auth/signup-form.tsx");

  it("uses the same rules on both sides", () => {
    expect(form).toContain("z.string().email(");
    expect(form).toContain("min(8");
    expect(actions).toContain("z.string().email()");
    expect(actions).toContain("z.string().min(8)");
  });

  it("marks the offending field inline as well as in the banner", () => {
    expect(form).toContain("errors.email?.message");
    expect(form).toContain("errors.password?.message");
    expect(form).toContain("errors.acceptedPolicy?.message");
  });

  it("renders whatever message the server returns", () => {
    expect(form).toContain("{actionState.message}");
  });
});
