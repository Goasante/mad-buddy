import { describe, expect, it } from "vitest";
import type { AuthError } from "@supabase/supabase-js";
import { describeSignInError } from "./sign-in-error";

/**
 * Sign-in failures must say what actually went wrong.
 *
 * THE INCIDENT THIS PINS (2026-09-12): the first Android build reported
 * "Email address or password is incorrect" on a phone whose mobile data was
 * sitting behind a carrier captive portal. Every request timed out
 * (net::ERR_TIMED_OUT to Supabase, to the API, and to example.com alike), so
 * signInWithPassword never reached an auth server and never rejected any
 * credential -- but the screen collapsed EVERY failure into the password
 * message.
 *
 * The cost was entirely diagnostic: the message sent us to verify the anon
 * key, the project URL, the secure-storage typing and the stored session,
 * none of which were at fault. An accurate message would have ended it at the
 * first tap.
 *
 * So the rule these tests hold: only a genuine credential rejection may
 * mention the password.
 */

const authError = (fields: Partial<AuthError>): AuthError =>
  ({ name: "AuthError", message: "", ...fields }) as AuthError;

/** The exact shape supabase-js produces when fetch itself throws. */
const networkFailure = () => authError({ message: "Failed to fetch", status: undefined });

describe("only a real credential rejection blames the password", () => {
  it("names the credentials when Supabase says invalid_credentials", () => {
    expect(describeSignInError(authError({ code: "invalid_credentials", status: 400 })))
      .toBe("Email address or password is incorrect.");
  });

  it("recognises the rejection from the message when no code is present", () => {
    // Older GoTrue responses carry no `code`.
    expect(describeSignInError(authError({ message: "Invalid login credentials", status: 400 })))
      .toBe("Email address or password is incorrect.");
  });

  it("NEVER blames the password when the request never reached Supabase", () => {
    const message = describeSignInError(networkFailure());
    expect(message).toBe("Could not reach Mad Buddy. Check your connection and try again.");
    // The regression, stated directly:
    expect(message).not.toMatch(/password/i);
    expect(message).not.toMatch(/incorrect/i);
  });

  it("treats a status-less failure as unreachable, whatever the message says", () => {
    // A timeout behind a captive portal is the case that caused the incident:
    // there is no HTTP status because no response ever arrived.
    expect(describeSignInError(authError({ message: "NetworkError when attempting to fetch resource" })))
      .toMatch(/connection/i);
  });
});

describe("the other failures are reported as themselves", () => {
  it("distinguishes an unconfirmed email", () => {
    expect(describeSignInError(authError({ code: "email_not_confirmed", status: 400 })))
      .toBe("This email address has not been confirmed yet.");
  });

  it("distinguishes a rate limit, which resolves by waiting", () => {
    // Telling someone their password is wrong here sends them to reset a
    // password that works, which only adds more rate-limited requests.
    const byStatus = describeSignInError(authError({ status: 429 }));
    expect(byStatus).toBe("Too many attempts. Wait a moment and try again.");
    expect(byStatus).not.toMatch(/password/i);
    expect(describeSignInError(authError({ code: "over_request_rate_limit", status: 429 })))
      .toBe("Too many attempts. Wait a moment and try again.");
  });

  it("distinguishes a banned account, which no password will open", () => {
    expect(describeSignInError(authError({ code: "user_banned", status: 403 })))
      .toBe("This account is not available. Contact support.");
  });

  it("surfaces an unrecognised server failure rather than guessing", () => {
    // An unexpected message is easier to report than a confident wrong one.
    expect(describeSignInError(authError({ message: "Database connection failed", status: 500 })))
      .toBe("Database connection failed");
  });

  it("falls back to something honest when there is no message at all", () => {
    expect(describeSignInError(authError({ status: 500 }))).toBe("Could not sign in. Try again.");
  });
});
