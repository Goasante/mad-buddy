import "server-only";

import { createClient } from "@supabase/supabase-js";
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
import { normalizeUsername, validateUsername } from "@/lib/profile/rules";
import { getSiteUrl } from "@/lib/seo";
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
    turnstileToken: z.string().max(2048).optional()
  })
  .superRefine((data, context) => {
    const usernameError = validateUsername(data.username);
    if (usernameError) context.addIssue({ code: "custom", path: ["username"], message: usernameError });
  });

export type MobileSignUpResult = {
  ok: boolean;
  message: string;
  requiresEmailConfirmation?: boolean;
};

/**
 * Registers a native-app account through the same public Supabase sign-up flow
 * as web. Supabase owns email verification; the native client must not receive
 * a session before the address is confirmed. Any creation error stays generic
 * so this endpoint cannot be used to discover registered email addresses.
 */
export async function registerUserWithEmailVerification(input: unknown): Promise<MobileSignUpResult> {
  const requestId = createRequestId();
  const startedAt = Date.now();

  const serverEnv = getSupabaseServerEnv();
  const publicEnv = getSupabaseBrowserEnv();
  if (!serverEnv.url || !serverEnv.serviceRoleKey || !publicEnv.url || !publicEnv.anonKey) {
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

  const challenge = await verifyTurnstileToken(parsed.data.turnstileToken, "signup");
  if (!challenge.ok) {
    return { ok: false, message: turnstileErrorMessage(challenge) };
  }

  const { fullName, username, email, password } = parsed.data;
  const authClient = createClient(publicEnv.url, publicEnv.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
  const admin = createSupabaseAdminClient();

  const { data, error } = await authClient.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${getSiteUrl().origin}/auth/callback?next=/login`,
      data: { full_name: fullName, username }
    }
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

  if (data.user.identities?.length === 0) {
    return {
      ok: true,
      message: "Check your email for the confirmation link.",
      requiresEmailConfirmation: true
    };
  }

  if (data.session) {
    await authClient.auth.signOut({ scope: "local" });
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

  return {
    ok: true,
    message: "Check your email and open the confirmation link before logging in.",
    requiresEmailConfirmation: true
  };
}
