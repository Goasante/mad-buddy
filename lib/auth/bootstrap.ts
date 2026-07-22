import "server-only";

import { z } from "zod";
import {
  consumeRateLimit,
  getClientIpHashFromHeaders,
  rateLimitMessage
} from "@/lib/security/rate-limit";
import { createRequestId, logBackendEvent } from "@/lib/observability/logger";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/env";
import { PRIVACY_POLICY_VERSION } from "@/lib/legal/consent";
import { normalizeUsername, validateUsername } from "@/lib/profile/rules";

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
    policyVersion: z.literal(PRIVACY_POLICY_VERSION)
  })
  .superRefine((data, context) => {
    const usernameError = validateUsername(data.username);
    if (usernameError) context.addIssue({ code: "custom", path: ["username"], message: usernameError });
  });

export type MobileSignUpResult = { ok: boolean; message: string };

/**
 * Registers a new account for the native app. Unlike the web action (which
 * relies on cookie-session sign-up), the mobile client establishes its own
 * Supabase session afterwards, so this endpoint just needs to create a
 * confirmed user and bootstrap its rows. Email is confirmed on creation for the
 * same reason web auto-confirms: sign-up must never depend on email delivery.
 *
 * Any creation error returns the same generic message, so this cannot be used
 * to discover which email addresses are already registered.
 */
export async function registerConfirmedUser(input: unknown): Promise<MobileSignUpResult> {
  const requestId = createRequestId();
  const startedAt = Date.now();

  const env = getSupabaseServerEnv();
  if (!env.url || !env.serviceRoleKey) {
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
    return { ok: false, message: "Please check the signup form and try again." };
  }

  const { fullName, username, email, password } = parsed.data;
  const admin = createSupabaseAdminClient();

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, username }
  });

  if (error || !data.user) {
    // Generic message for every failure (incl. "already registered") so the
    // endpoint never reveals whether an address is registered.
    logBackendEvent("warn", {
      requestId,
      action: "auth.signup",
      statusCode: 400,
      latencyMs: Date.now() - startedAt,
      errorType: error?.name ?? "create_user_failed"
    });
    return { ok: false, message: "Your account could not be created. Check the form and try again." };
  }

  const bootstrapResults = await bootstrapNewUser(admin, {
    userId: data.user.id,
    fullName,
    username
  });
  const failedBootstrap = bootstrapResults.find((result) => result.error);
  for (const { label, error: rowError } of bootstrapResults) {
    if (rowError) {
      logBackendEvent("error", {
        requestId,
        action: "auth.signup",
        statusCode: 500,
        latencyMs: Date.now() - startedAt,
        userId: data.user.id,
        errorType: `bootstrap_${label}_failed`
      });
    }
  }

  if (failedBootstrap) {
    await admin.auth.admin.deleteUser(data.user.id);
    const code = (failedBootstrap.error as { code?: string } | null)?.code;
    return {
      ok: false,
      message:
        failedBootstrap.label === "profile" && code === "23505"
          ? "That username is already taken. Try another one."
          : "Your account could not be set up. Please try again."
    };
  }

  logBackendEvent("info", {
    requestId,
    action: "auth.signup",
    statusCode: 200,
    latencyMs: Date.now() - startedAt,
    userId: data.user.id
  });

  return { ok: true, message: "Account created. Continue onboarding." };
}
