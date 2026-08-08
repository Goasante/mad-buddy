import "server-only";

import { z } from "zod";
import {
  consumeRateLimit,
  getClientIpHashFromHeaders,
  rateLimitMessage
} from "@/lib/security/rate-limit";
import { createRequestId, logBackendEvent } from "@/lib/observability/logger";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseBrowserEnv, getSupabaseServerEnv } from "@/lib/supabase/env";
import { PRIVACY_POLICY_VERSION } from "@/lib/legal/consent";
import { recordSignupConsent } from "@/lib/legal/consent-logger";
import { normalizeUsername, validateUsername } from "@/lib/profile/rules";
import { turnstileErrorMessage, verifyTurnstileToken } from "@/lib/security/turnstile";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

/**
 * Creates the per-user rows a new account needs (profile / subscription /
 * preferences). Keyed on user_id (onConflict) so it is idempotent and safe to
 * re-run. Shared by the web `signUpAction` and the mobile `/api/auth/signup`
 * route so the two sign-up paths can never drift apart.
 *
 * The service role bypasses RLS, so the rows are always created regardless of
 * whether a session exists yet (e.g. when email confirmation is required).
 */
export async function bootstrapNewUser(
  admin: Admin,
  { userId, fullName, username }: { userId: string; fullName: string; username: string }
): Promise<{ label: "profile" | "subscription" | "preferences"; error: unknown }[]> {
  const normalizedUsername = normalizeUsername(username);
  const [profileResult, subscriptionResult, preferencesResult] = await Promise.all([
    admin.from("profiles").upsert(
      {
        user_id: userId,
        full_name: fullName,
        username: normalizedUsername,
        username_normalized: normalizedUsername,
        is_onboarded: false
      },
      { onConflict: "user_id" }
    ),
    admin.from("subscriptions").upsert(
      {
        user_id: userId,
        plan: "free",
        status: "free"
      },
      { onConflict: "user_id" }
    ),
    admin.from("user_preferences").upsert(
      {
        user_id: userId
      },
      { onConflict: "user_id" }
    )
  ]);

  return [
    { label: "profile", error: profileResult.error },
    { label: "subscription", error: subscriptionResult.error },
    { label: "preferences", error: preferencesResult.error }
  ];
}

/**
 * Creates a pre-confirmed account, and the rows that go with it.
 *
 * THE ONE PLACE AN ACCOUNT IS CREATED. Web and mobile both call this, because
 * the last time they each had their own copy the two drifted into different
 * verification policies without anyone noticing.
 *
 * WHY admin.createUser AND NOT auth.signUp:
 *
 *   Mad Buddy does not verify email at sign-up. `auth.signUp` tries to SEND a
 *   confirmation message through Supabase's built-in SMTP, which allows only a
 *   few per hour; once exhausted it fails outright and creates NO account. The
 *   user is told they signed up, then gets "invalid login credentials" for an
 *   account that never existed. That was a real, reproduced production
 *   incident, and it is a failure mode with no upside here because the app
 *   never uses the confirmation link.
 *
 *   `admin.createUser({ email_confirm: true })` sends nothing, cannot be rate
 *   limited, and marks the address confirmed in the same call.
 *
 * WHY THIS DOES NOT READ THE DASHBOARD SETTING:
 *
 *   `email_confirm: true` is applied by the service role at creation time, so
 *   the account is usable whether or not "Confirm email" is enabled in the
 *   Supabase project. Behaviour is decided by this code, not by a toggle
 *   someone can flip in a console. Enabling that setting cannot strand a user
 *   here the way it could with auth.signUp.
 *
 * Rolls back on failure: an auth user whose profile row could not be created
 * can log in but can never finish onboarding, so it is deleted rather than
 * left behind as an orphan.
 */
export type CreatedAccount = {
  userId: string;
  email: string;
};

export type AccountCreationFailure = {
  reason: "duplicate" | "provider" | "bootstrap";
  /** The bootstrap row that failed, when reason is "bootstrap". */
  label?: "profile" | "subscription" | "preferences";
  code?: string;
  error?: unknown;
};

export async function createConfirmedAccount(
  admin: Admin,
  {
    email,
    password,
    fullName,
    username,
    requestId,
    startedAt
  }: {
    email: string;
    password: string;
    fullName: string;
    /**
     * The username to claim, or a function deriving it from the new user id.
     *
     * Web has no username at sign-up and uses a placeholder derived from the
     * id -- which does not exist until createUser returns, hence the callback.
     * Deriving it from the email instead would leak part of the address into a
     * publicly visible username.
     */
    username: string | ((userId: string) => string);
    requestId: string;
    startedAt: number;
  }
): Promise<{ ok: true; account: CreatedAccount } | { ok: false; failure: AccountCreationFailure }> {
  // Resolved after creation when it depends on the id; a fixed username is
  // used as-is so the mobile path keeps claiming the name the user chose.
  const fixedUsername = typeof username === "string" ? username : null;

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    // The whole point. No email is sent, and the address is confirmed by this
    // call rather than by a link the product never uses.
    email_confirm: true,
    user_metadata: fixedUsername ? { full_name: fullName, username: fixedUsername } : { full_name: fullName }
  });

  if (createError || !created?.user) {
    const duplicate =
      (createError && "code" in createError && (createError as { code?: string }).code === "email_exists") ||
      /already|registered|exists/i.test(createError?.message ?? "");

    logBackendEvent(duplicate ? "info" : "warn", {
      requestId,
      action: "auth.signup",
      statusCode: duplicate ? 200 : 400,
      latencyMs: Date.now() - startedAt,
      errorType: duplicate ? "duplicate_email" : (createError?.name ?? "create_user_failed")
    });

    return { ok: false, failure: { reason: duplicate ? "duplicate" : "provider", error: createError } };
  }

  const resolvedUsername = typeof username === "string" ? username : username(created.user.id);

  const bootstrapResults = await bootstrapNewUser(admin, {
    userId: created.user.id,
    fullName,
    username: resolvedUsername
  });

  for (const { label, error: rowError } of bootstrapResults) {
    if (rowError) {
      logBackendEvent("error", {
        requestId,
        action: "auth.signup",
        statusCode: 500,
        latencyMs: Date.now() - startedAt,
        userId: created.user.id,
        errorType: `bootstrap_${label}_failed`
      });
    }
  }

  const failedBootstrap = bootstrapResults.find((result) => result.error);
  if (failedBootstrap) {
    // No auth-only accounts. Such a user appears in Admin, can log in, and can
    // never complete onboarding because the profile row it needs is missing.
    await admin.auth.admin.deleteUser(created.user.id);
    return {
      ok: false,
      failure: {
        reason: "bootstrap",
        label: failedBootstrap.label,
        code: (failedBootstrap.error as { code?: string } | null)?.code,
        error: failedBootstrap.error
      }
    };
  }

  return { ok: true, account: { userId: created.user.id, email } };
}

const mobileSignupSchema = z
  .object({
    fullName: z.string().min(2),
    username: z
      .string()
      .min(3)
      .max(24)
      .regex(/^[a-z0-9_]+$/),
    email: z.string().email(),
    password: z.string().min(8),
    acceptedPolicy: z.literal(true),
    policyVersion: z.literal(PRIVACY_POLICY_VERSION),
    // nullable AND optional, for the same reason as the web schema: a client
    // holding this as `string | null` sends null when no token was issued,
    // which a plain .optional() rejects. verifyTurnstileToken enforces the
    // challenge; the schema only accepts the shape the client sends.
    turnstileToken: z.string().max(2048).nullable().optional()
  })
  .superRefine((data, context) => {
    const usernameError = validateUsername(data.username);
    if (usernameError) context.addIssue({ code: "custom", path: ["username"], message: usernameError });
  });

/**
 * Turns Zod issues from the native sign-up schema into one specific sentence.
 *
 * Mirrors the web mapping in app/(auth)/actions.ts. The username rule carries
 * its own message from validateUsername (it explains exactly which character
 * is wrong), so that one is passed through rather than replaced.
 */
function nativeSignupValidationMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  const field = issue?.path[0];

  switch (field) {
    case "fullName":
      return "Enter your name.";
    case "username":
      // validateUsername supplies a precise reason; a generic sentence here
      // would be less helpful than what the rule already says.
      return issue?.message || "Choose a username with letters, numbers or underscores.";
    case "email":
      return "Enter a valid email address.";
    case "password":
      return "Password must be at least 8 characters.";
    case "acceptedPolicy":
      return "Please accept the Terms and Privacy Policy.";
    case "policyVersion":
      return "Our Terms have been updated. Reload the app and try again.";
    case "turnstileToken":
      return "Your security check expired. Try again.";
    default:
      return "Please check the signup form and try again.";
  }
}

export type MobileSignUpResult = {
  ok: boolean;
  message: string;
};

/**
 * Registers a native-app account.
 *
 * Delegates account creation to createConfirmedAccount, the same function the
 * web action uses, so both paths share one verification policy by construction.
 * Mad Buddy does not verify email at sign-up: the account is created confirmed
 * and the client signs in straight away.
 *
 * Any creation error stays generic so this endpoint cannot be used to discover
 * which email addresses are registered.
 */
export async function registerUserWithEmailVerification(input: unknown): Promise<MobileSignUpResult> {
  const requestId = createRequestId();
  const startedAt = Date.now();

  const serverEnv = getSupabaseServerEnv();
  // Only the service role is required now: account creation no longer goes
  // through an anon client, so the browser keys are not part of this path.
  if (!serverEnv.url || !serverEnv.serviceRoleKey) {
    return { ok: false, message: "Sign-up is not available right now." };
  }

  const rateLimit = await consumeRateLimit({
    action: "auth.signup",
    ipHash: await getClientIpHashFromHeaders(),
    requestId
  });
  if (!rateLimit.allowed) {
    return { ok: false, message: rateLimitMessage(rateLimit.resetAt) };
  }

  const parsed = mobileSignupSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: nativeSignupValidationMessage(parsed.error) };
  }

  const challenge = await verifyTurnstileToken(parsed.data.turnstileToken, "signup");
  if (!challenge.ok) {
    return { ok: false, message: turnstileErrorMessage(challenge) };
  }

  const { fullName, username, email, password } = parsed.data;
  const admin = createSupabaseAdminClient();

  // The SAME creator the web action uses. Both paths therefore share one
  // verification policy by construction rather than by two copies agreeing.
  const creation = await createConfirmedAccount(admin, {
    email,
    password,
    fullName,
    username,
    requestId,
    startedAt
  });

  if (!creation.ok) {
    if (creation.failure.reason === "bootstrap") {
      const code = creation.failure.code;
      return {
        ok: false,
        message:
          creation.failure.label === "profile" && code === "23505"
            ? "That username is already taken. Try another one."
            : "Your account could not be set up. Please try again."
      };
    }

    // One generic message for both duplicate and provider failures, so the
    // endpoint never reveals whether an address is already registered.
    return { ok: false, message: "Your account could not be created. Check the form and try again." };
  }

  // The consent the native signup screen collected. Logged with the id the
  // server just created, never one supplied by the client.
  await recordSignupConsent(admin, { userId: creation.account.userId, requestId, source: "signup" });

  logBackendEvent("info", {
    requestId,
    action: "auth.signup",
    statusCode: 200,
    latencyMs: Date.now() - startedAt,
    userId: creation.account.userId
  });

  // No confirmation step: the account is created already confirmed, so the
  // native client signs in immediately. Telling the user to check their email
  // would send them looking for a message that is never sent.
  return { ok: true, message: "Account created. You can sign in now." };
}
