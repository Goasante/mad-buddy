import type { AuthError } from "@supabase/supabase-js";

/**
 * Turns a Supabase sign-in failure into something true.
 *
 * Supabase distinguishes these clearly; the login screen used to collapse them
 * all into "password incorrect", which is actively misleading when the real
 * cause is a dropped connection or a rate limit. `invalid_credentials` is the
 * ONLY case that should mention the password.
 *
 * This lives apart from LoginScreen deliberately: importing the screen pulls in
 * the Supabase client, which reads `window` as it initialises. The mapping is
 * pure, and keeping it pure is what lets it be tested directly.
 */
export function describeSignInError(error: AuthError): string {
  const code = error.code ?? "";
  const message = error.message ?? "";

  if (code === "invalid_credentials" || /invalid login credentials/i.test(message)) {
    return "Email address or password is incorrect.";
  }
  if (code === "email_not_confirmed" || /email not confirmed/i.test(message)) {
    return "This email address has not been confirmed yet.";
  }
  if (code === "over_request_rate_limit" || error.status === 429) {
    return "Too many attempts. Wait a moment and try again.";
  }
  if (code === "user_banned") {
    return "This account is not available. Contact support.";
  }
  // No status at all almost always means the request never reached Supabase.
  if (!error.status || /fetch|network/i.test(message)) {
    return "Could not reach Mad Buddy. Check your connection and try again.";
  }
  // Anything unrecognised shows the real message rather than a guess: an
  // unexpected failure is easier to report than to misdescribe.
  return message || "Could not sign in. Try again.";
}
