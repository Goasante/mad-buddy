import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { stripComments } from "@/lib/content/strip-comments";
import { SIGNUP_CONSENT_TYPE, consentTextFor } from "@/lib/legal/consent-logger";
import { PRIVACY_POLICY_VERSION } from "@/lib/legal/consent";

/**
 * Mad Buddy does not verify email at sign-up.
 *
 * These guard a decision that has already been reversed once. Commit 95ff7cb
 * moved BOTH web and mobile from `admin.createUser` to `auth.signUp`, which
 * makes account creation depend on Supabase's built-in SMTP -- a service capped
 * at a few messages an hour, after which sign-up fails and creates NO account
 * while telling the user it succeeded. Nothing in the test suite noticed.
 */

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const bootstrap = stripComments(read("lib/auth/bootstrap.ts"));
const webAction = stripComments(read("app/(auth)/actions.ts"));
const consentLogger = stripComments(read("lib/legal/consent-logger.ts"));
const nativeSignup = stripComments(read("mobile/src/screens/SignupScreen.tsx"));
const signupForm = stripComments(read("components/auth/signup-form.tsx"));

// ---------------------------------------------------------------------------
// One policy, one implementation
// ---------------------------------------------------------------------------

describe("web and mobile create accounts the same way", () => {
  it("routes both through one shared creator", () => {
    // Two copies is how the policies drifted apart last time.
    expect(webAction).toContain("createConfirmedAccount(admin, {");
    expect(bootstrap).toContain("export async function createConfirmedAccount");
    const mobile = bootstrap.slice(bootstrap.indexOf("registerUserWithEmailVerification"));
    expect(mobile).toContain("createConfirmedAccount(admin, {");
  });

  it("creates the account with the service role, never a public sign-up", () => {
    expect(bootstrap).toContain("admin.auth.admin.createUser({");
  });

  it("never calls auth.signUp anywhere in the signup path", () => {
    // THE REGRESSION ITSELF. auth.signUp sends a confirmation email through
    // rate-limited SMTP; when that quota is gone it creates no account at all.
    expect(bootstrap).not.toContain("auth.signUp(");
    expect(webAction).not.toContain("auth.signUp(");
  });
});

// ---------------------------------------------------------------------------
// Confirmed by code, not by dashboard
// ---------------------------------------------------------------------------

describe("account confirmation does not depend on project configuration", () => {
  it("marks the email confirmed at creation", () => {
    expect(bootstrap).toContain("email_confirm: true");
  });

  it("sends no confirmation email and needs no redirect target", () => {
    // emailRedirectTo only matters when a confirmation link is issued. Its
    // presence would mean the flow still expects one.
    expect(bootstrap).not.toContain("emailRedirectTo");
    expect(webAction).not.toContain("emailRedirectTo");
  });

  it("cannot be changed by the Confirm Email dashboard setting", () => {
    // email_confirm is applied by the service role at creation time, so the
    // account is usable whichever way that toggle is set. Nothing in the path
    // branches on a confirmation state supplied by the provider.
    expect(bootstrap).not.toContain("identities?.length === 0");
    expect(webAction).not.toContain("identities?.length === 0");
  });

  it("exposes no email-confirmation flag to clients", () => {
    expect(bootstrap).not.toContain("requiresEmailConfirmation");
    expect(nativeSignup).not.toContain("requiresEmailConfirmation");
  });
});

// ---------------------------------------------------------------------------
// No dead ends
// ---------------------------------------------------------------------------

describe("a successful signup moves the user forward", () => {
  it("sends web users into onboarding", () => {
    expect(webAction).toContain('redirectTo: "/onboarding"');
  });

  it("establishes the web session before redirecting", () => {
    // admin.createUser does NOT create a browser session; without this the
    // redirect would land on a guard and bounce straight back to login.
    expect(webAction).toContain("signInWithPassword({ email, password })");
    const session = webAction.slice(webAction.indexOf("signInWithPassword({ email, password })"));
    expect(session).toContain('redirectTo: "/onboarding"');
  });

  it("keeps a session failure recoverable rather than fatal", () => {
    // The account exists, so the honest outcome is "log in", not "signup
    // failed".
    expect(webAction).toContain('message: "Account created. Log in to continue.", redirectTo: "/login"');
  });

  it("signs native users in rather than showing a notice", () => {
    expect(nativeSignup).toContain("signInWithPassword({");
    expect(nativeSignup).toContain('navigate("/onboarding"');
  });

  it("leaves no check-your-email messaging on any signup path", () => {
    // This was a live dead end: the form told users to open a confirmation
    // link that is never sent, and gave them no redirect, so they simply sat
    // on the signup page.
    for (const [name, source] of [
      ["web action", webAction],
      ["bootstrap", bootstrap],
      ["native screen", nativeSignup]
    ] as const) {
      expect(source.toLowerCase(), `${name} must not mention a confirmation email`).not.toContain(
        "confirmation link"
      );
      expect(source.toLowerCase(), `${name} must not tell users to check email`).not.toContain("check your email");
    }
  });

  it("always returns somewhere to go on success", () => {
    // The dead end existed because a success returned no redirectTo, and the
    // form only navigates when one is present.
    expect(signupForm).toContain("result.redirectTo");
    // Scoped to signUpAction. Other actions (password reset, for one) return
    // ok:true without a destination for good reason -- the user stays put and
    // reads a message.
    const signUp = webAction.slice(
      webAction.indexOf("export async function signUpAction"),
      webAction.indexOf("export async function loginAction")
    );
    const successes = [...signUp.matchAll(/return \{ ok: true[^}]*\}/g)].map((match) => match[0]);
    expect(successes.length).toBeGreaterThan(0);
    for (const success of successes) {
      expect(success, `success without a destination: ${success}`).toContain("redirectTo");
    }
  });
});

// ---------------------------------------------------------------------------
// Consent
// ---------------------------------------------------------------------------

describe("consent is recorded for the account that was created", () => {
  it("uses the existing consent_logs table", () => {
    expect(consentLogger).toContain('admin.from("consent_logs").insert(');
  });

  it("takes the user id from the server, never the client", () => {
    // A client-supplied id would let one account write consent attributed to
    // another.
    expect(webAction).toContain("recordSignupConsent(admin, { userId, requestId");
    expect(bootstrap).toContain("userId: creation.account.userId");
  });

  it("logs only the single consent the UI collects", () => {
    // One checkbox covers Terms and Privacy together. Writing two rows would
    // claim two decisions from one tick.
    expect(SIGNUP_CONSENT_TYPE).toBe("privacy_policy");
    expect(consentLogger.match(/consent_logs"\)\.insert\(/g) ?? []).toHaveLength(1);
  });

  it("records the canonical policy version", () => {
    expect(consentTextFor(PRIVACY_POLICY_VERSION)).toContain(PRIVACY_POLICY_VERSION);
    expect(consentLogger).toContain("policyVersion: PRIVACY_POLICY_VERSION");
  });

  it("lets the database own the timestamp", () => {
    // created_at defaults to now(). Sending one would let a client clock, or a
    // retry minutes later, decide when consent was given.
    const insert = consentLogger.slice(consentLogger.indexOf('consent_logs").insert('));
    expect(insert.slice(0, 300)).not.toContain("created_at:");
  });

  it("runs only after the account exists", () => {
    // There is no user id to attribute consent to before that point.
    const creationAt = webAction.indexOf("createConfirmedAccount");
    const consentAt = webAction.indexOf("recordSignupConsent");
    expect(creationAt).toBeGreaterThan(-1);
    expect(consentAt).toBeGreaterThan(creationAt);
  });
});

describe("consent failure behaviour is explicit", () => {
  it("never fails silently", () => {
    // The previous logger was a no-op that resolved successfully, so a missing
    // consent record was indistinguishable from a written one.
    expect(consentLogger).toContain("throw error");
    expect(consentLogger).toContain('action: "auth.signup_consent"');
    expect(consentLogger).toContain('logBackendEvent("error"');
  });

  it("does not roll back an account the user was told they created", () => {
    // Deleting a real account because of a transient database error is worse
    // than a recoverable gap in the consent log, which the error entry above
    // makes backfillable.
    const recorder = consentLogger.slice(consentLogger.indexOf("export async function recordSignupConsent"));
    expect(recorder).toContain("return { ok: false }");
    expect(recorder).not.toContain("deleteUser");
  });

  it("reports the user id with the failure, so it can be backfilled", () => {
    const recorder = consentLogger.slice(consentLogger.indexOf("catch (error)"));
    expect(recorder.slice(0, 400)).toContain("userId");
  });
});

// ---------------------------------------------------------------------------
// Hardening from 95ff7cb survives
// ---------------------------------------------------------------------------

describe("the security work added alongside the regression is preserved", () => {
  it("keeps the signup bot challenge", () => {
    expect(webAction).toContain('verifyTurnstileToken(parsed.data.turnstileToken, "signup")');
    expect(bootstrap).toContain('verifyTurnstileToken(parsed.data.turnstileToken, "signup")');
  });

  it("keeps the password-recovery challenge", () => {
    expect(webAction).toContain('verifyTurnstileToken(parsed.data.turnstileToken, "password_recovery")');
  });

  it("keeps global session revocation on password reset", () => {
    expect(webAction).toContain('signOut({ scope: "global" })');
  });

  it("keeps signup rate limiting on both paths", () => {
    expect(webAction).toContain('action: "auth.signup"');
    expect(bootstrap).toContain('consumeRateLimit({');
  });

  it("keeps the policy-version gate on the accepted consent", () => {
    expect(webAction).toContain("policyVersion: z.literal(PRIVACY_POLICY_VERSION)");
    expect(bootstrap).toContain("policyVersion: z.literal(PRIVACY_POLICY_VERSION)");
  });
});

// ---------------------------------------------------------------------------
// Account integrity
// ---------------------------------------------------------------------------

describe("a half-created account is never left behind", () => {
  it("deletes the auth user when its rows cannot be created", () => {
    // Such an account can log in but can never finish onboarding, because the
    // profile row it needs is missing.
    const creator = bootstrap.slice(bootstrap.indexOf("export async function createConfirmedAccount"));
    expect(creator).toContain("admin.auth.admin.deleteUser(created.user.id)");
  });

  it("derives the web placeholder username from the user id, not the email", () => {
    // The username is public; deriving it from the address would leak part of
    // it to everyone who can see the profile.
    expect(webAction).toContain("createPlaceholderUsername(userId)");
    expect(webAction).not.toContain("createPlaceholderUsername(email)");
  });

  it("keeps bootstrap idempotent, so a retry cannot duplicate rows", () => {
    expect(bootstrap).toContain('{ onConflict: "user_id" }');
  });
});
