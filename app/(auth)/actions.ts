"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getSiteUrl } from "@/lib/seo";
import { createRequestId, errorType, logBackendEvent } from "@/lib/observability/logger";
import {
  consumeRateLimit,
  getClientIpHashFromHeaders,
  rateLimitMessage
} from "@/lib/security/rate-limit";
import { getAdminEmailAccess } from "@/lib/safety/admin";
import { bootstrapNewUser } from "@/lib/auth/bootstrap";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseBrowserEnv } from "@/lib/supabase/env";
import { PRIVACY_POLICY_VERSION } from "@/lib/legal/consent";
import { createPlaceholderUsername, PLACEHOLDER_DISPLAY_NAME } from "@/lib/profile/placeholder-identity";
import { safeAuthNext } from "@/lib/auth/oauth-redirect";
import { turnstileErrorMessage, verifyTurnstileToken } from "@/lib/security/turnstile";

export type AuthActionState = {
  ok: boolean;
  message: string;
  redirectTo?: string;
};

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  acceptedPolicy: z.literal(true),
  policyVersion: z.literal(PRIVACY_POLICY_VERSION),
  turnstileToken: z.string().max(2048).optional()
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  next: z.string().max(2048).optional()
});

const forgotPasswordSchema = z.object({
  email: z.string().email(),
  turnstileToken: z.string().max(2048).optional()
});

const resetPasswordSchema = z
  .object({
    password: z.string().min(8),
    confirmPassword: z.string().min(8)
  })
  .refine((data) => data.password === data.confirmPassword);

const logoutSchema = z.object({
  pushEndpoint: z.string().url().max(1000).nullable().optional()
});

/**
 * The public origin to build email/callback links from. Derived from the actual
 * request (host / x-forwarded-* on Vercel) so links are always correct even when
 * NEXT_PUBLIC_APP_URL is unset or empty — which is exactly what sent password-
 * reset emails pointing at http://localhost:3000. Falls back to the configured
 * site URL only if request headers are unavailable.
 */
async function resolveRequestOrigin(): Promise<string> {
  try {
    const headerList = await headers();
    const origin = headerList.get("origin");
    if (origin) return origin.replace(/\/+$/, "");
    const host = headerList.get("x-forwarded-host") ?? headerList.get("host");
    if (host) {
      const proto = headerList.get("x-forwarded-proto") ?? "https";
      return `${proto}://${host}`;
    }
  } catch {
    // headers() not available in this context — fall through.
  }
  return getSiteUrl().origin;
}

/**
 * The provider's shared email service caps sends to a few per hour. That's a
 * global condition (not tied to a specific account), so surfacing it can't leak
 * whether an address is registered.
 */
function isEmailRateLimited(error: { message?: string; code?: string; status?: number }): boolean {
  const message = (error.message ?? "").toLowerCase();
  return error.status === 429 || error.code === "over_email_send_rate_limit" || message.includes("rate limit");
}

function missingSupabaseState(): AuthActionState | null {
  const env = getSupabaseBrowserEnv();

  if (!env.url || !env.anonKey) {
    return {
      ok: false,
      message: "Supabase is not configured yet. Add values to .env.local, then restart the dev server."
    };
  }

  return null;
}

export async function signUpAction(input: unknown): Promise<AuthActionState> {
  const requestId = createRequestId();
  const startedAt = Date.now();
  const missingEnv = missingSupabaseState();

  if (missingEnv) {
    logBackendEvent("warn", {
      requestId,
      action: "auth.signup",
      statusCode: 503,
      latencyMs: Date.now() - startedAt
    });
    return missingEnv;
  }

  const rateLimit = await consumeRateLimit({
    action: "auth.signup",
    ipHash: await getClientIpHashFromHeaders(),
    requestId
  });

  if (!rateLimit.allowed) {
    return { ok: false, message: rateLimitMessage(rateLimit.resetAt) };
  }

  const parsed = signupSchema.safeParse(input);

  if (!parsed.success) {
    logBackendEvent("warn", {
      requestId,
      action: "auth.signup",
      statusCode: 400,
      latencyMs: Date.now() - startedAt
    });
    return { ok: false, message: "Please check the signup form and try again." };
  }

  const challenge = await verifyTurnstileToken(parsed.data.turnstileToken, "signup");
  if (!challenge.ok) {
    logBackendEvent("warn", {
      requestId,
      action: "auth.signup_turnstile",
      statusCode: challenge.reason === "missing_secret" ? 503 : 400,
      latencyMs: Date.now() - startedAt,
      errorType: challenge.reason
    });
    return { ok: false, message: turnstileErrorMessage(challenge) };
  }

  const { email, password } = parsed.data;

  const supabase = await createSupabaseServerClient();
  const origin = await resolveRequestOrigin();

  // Ordinary accounts use Supabase's public sign-up flow. The provider owns
  // email verification and does not issue an application session until the
  // address has been confirmed.
  // TODO(consent): Persist a PolicyConsentEvent through ConsentLogger after
  // consent_logs RLS, retention, and audit access are approved.
  const { data: created, error: createError } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${origin}/auth/callback?next=/onboarding`,
      data: { full_name: PLACEHOLDER_DISPLAY_NAME }
    }
  });

  if (createError || !created?.user) {
    // Duplicate email: keep the response indistinguishable from a fresh sign-up
    // so the form can't be used to discover which addresses are registered;
    // returning users are nudged to log in.
    const duplicate =
      (createError && "code" in createError && (createError as { code?: string }).code === "email_exists") ||
      /already|registered|exists/i.test(createError?.message ?? "");
    if (duplicate) {
      logBackendEvent("info", { requestId, action: "auth.signup", statusCode: 200, latencyMs: Date.now() - startedAt });
      return { ok: true, message: "Check your email for the confirmation link." };
    }
    logBackendEvent("warn", {
      requestId,
      action: "auth.signup",
      statusCode: 400,
      latencyMs: Date.now() - startedAt,
      errorType: createError?.name ?? "create_user_failed"
    });
    return { ok: false, message: "Your account could not be created. Check the form and try again." };
  }

  if (created.user.identities?.length === 0) {
    return { ok: true, message: "Check your email for the confirmation link." };
  }

  if (created.session) {
    await supabase.auth.signOut({ scope: "local" });
  }

  const admin = createSupabaseAdminClient();

  // Per-user rows (profile / subscription / preferences). Idempotent; shared
  // with the mobile path (lib/auth/bootstrap) so the two can't drift.
  const bootstrapResults = await bootstrapNewUser(admin, {
    userId: created.user.id,
    fullName: PLACEHOLDER_DISPLAY_NAME,
    username: createPlaceholderUsername(created.user.id)
  });
  const failedBootstrap = bootstrapResults.find((result) => result.error);
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

  if (failedBootstrap) {
    // Do not leave an auth-only account behind. It appears in Admin but cannot
    // complete onboarding because its required profile row was never created.
    await admin.auth.admin.deleteUser(created.user.id);
    const code = (failedBootstrap.error as { code?: string } | null)?.code;
    return {
      ok: false,
      message:
        failedBootstrap.label === "profile" && code === "23505"
          ? "Your account could not be prepared. Please try again."
          : "Your account could not be set up. Please try again."
    };
  }

  logBackendEvent("info", {
    requestId,
    action: "auth.signup",
    statusCode: 200,
    latencyMs: Date.now() - startedAt,
    userId: created.user.id
  });
  return {
    ok: true,
    message: "Check your email and open the confirmation link to continue."
  };
}

export async function loginAction(input: unknown): Promise<AuthActionState> {
  const requestId = createRequestId();
  const startedAt = Date.now();
  const missingEnv = missingSupabaseState();

  if (missingEnv) {
    logBackendEvent("warn", {
      requestId,
      action: "auth.login",
      statusCode: 503,
      latencyMs: Date.now() - startedAt
    });
    return missingEnv;
  }

  const rateLimit = await consumeRateLimit({
    action: "auth.login",
    ipHash: await getClientIpHashFromHeaders(),
    requestId
  });

  if (!rateLimit.allowed) {
    return { ok: false, message: rateLimitMessage(rateLimit.resetAt) };
  }

  const parsed = loginSchema.safeParse(input);

  if (!parsed.success) {
    logBackendEvent("warn", {
      requestId,
      action: "auth.login",
      statusCode: 400,
      latencyMs: Date.now() - startedAt
    });
    return { ok: false, message: "Enter a valid email and password." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password
  });

  if (error) {
    logBackendEvent("warn", {
      requestId,
      action: "auth.login",
      statusCode: 401,
      latencyMs: Date.now() - startedAt,
      errorType: errorType(error)
    });
    if (error.name === "AuthRetryableFetchError") {
      return {
        ok: false,
        message: "Mad Buddy could not reach the login service. Check your connection and try again."
      };
    }

    // Distinct from wrong credentials: the account exists but hasn't
    // confirmed its email yet. The client must not fold this into the
    // generic "incorrect" message, that's precisely what left new users
    // unable to tell "you typed the wrong password" apart from "you haven't
    // confirmed your email," with no way to recover from the second one.
    if (error.code === "email_not_confirmed") {
      return {
        ok: false,
        message:
          "Confirm your email first, check your inbox (and spam folder) for the link, or request a new one from the signup page."
      };
    }

    return { ok: false, message: "Email address or password is incorrect." };
  }

  logBackendEvent("info", {
    requestId,
    action: "auth.login",
    statusCode: 200,
    latencyMs: Date.now() - startedAt
  });

  return {
    ok: true,
    message: "Logged in.",
    redirectTo: safeAuthNext(parsed.data.next ?? null)
  };
}

export async function adminLoginAction(input: unknown): Promise<AuthActionState> {
  const requestId = createRequestId();
  const startedAt = Date.now();
  const missingEnv = missingSupabaseState();

  if (missingEnv) {
    logBackendEvent("warn", {
      requestId,
      action: "auth.admin_login",
      statusCode: 503,
      latencyMs: Date.now() - startedAt
    });
    return missingEnv;
  }

  const rateLimit = await consumeRateLimit({
    action: "auth.login",
    ipHash: await getClientIpHashFromHeaders(),
    requestId
  });

  if (!rateLimit.allowed) {
    return { ok: false, message: rateLimitMessage(rateLimit.resetAt) };
  }

  const parsed = loginSchema.safeParse(input);

  if (!parsed.success) {
    logBackendEvent("warn", {
      requestId,
      action: "auth.admin_login",
      statusCode: 400,
      latencyMs: Date.now() - startedAt
    });
    return { ok: false, message: "Enter a valid admin email and password." };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password
  });

  if (error || !data.user?.email) {
    logBackendEvent("warn", {
      requestId,
      action: "auth.admin_login",
      statusCode: 401,
      latencyMs: Date.now() - startedAt,
      errorType: error ? errorType(error) : "missing_user"
    });
    return { ok: false, message: "Admin email address or password is incorrect." };
  }

  const access = await getAdminEmailAccess(data.user.email);

  if (!access.ok) {
    await supabase.auth.signOut();
    logBackendEvent("warn", {
      requestId,
      action: "auth.admin_login",
      statusCode: 403,
      latencyMs: Date.now() - startedAt,
      userId: data.user.id,
      errorType: "not_allowed"
    });
    return { ok: false, message: "This account is not allowed to access the admin dashboard." };
  }

  logBackendEvent("info", {
    requestId,
    action: "auth.admin_login",
    statusCode: 200,
    latencyMs: Date.now() - startedAt,
    userId: data.user.id
  });

  return {
    ok: true,
    message: "Admin login successful.",
    redirectTo: safeAuthNext(parsed.data.next ?? null, "/admin")
  };
}

export async function forgotPasswordAction(input: unknown): Promise<AuthActionState> {
  const missingEnv = missingSupabaseState();

  if (missingEnv) {
    return missingEnv;
  }

  const parsed = forgotPasswordSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, message: "Enter a valid email address." };
  }

  const rateLimit = await consumeRateLimit({
    action: "auth.password_recovery",
    ipHash: await getClientIpHashFromHeaders()
  });
  if (!rateLimit.allowed) {
    return { ok: false, message: rateLimitMessage(rateLimit.resetAt) };
  }

  const challenge = await verifyTurnstileToken(parsed.data.turnstileToken, "password_recovery");
  if (!challenge.ok) {
    return { ok: false, message: turnstileErrorMessage(challenge) };
  }

  const origin = await resolveRequestOrigin();
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${origin}/auth/callback?next=/reset-password`
  });

  // Keep the response identical whether or not the address exists (the provider
  // error is not returned, to avoid account discovery) — EXCEPT for the mailer
  // rate limit, which is global, not account-specific, so telling the user their
  // email genuinely isn't coming leaks nothing and beats a false "sent".
  if (error) {
    logBackendEvent("warn", { action: "auth.password_recovery", statusCode: 400, errorType: errorType(error) });
    if (isEmailRateLimited(error)) {
      return {
        ok: false,
        message: "We can't send reset emails right now — the mailer is temporarily busy. Please try again in a few minutes."
      };
    }
  }

  return { ok: true, message: "If an account exists for that email, a reset link has been sent." };
}

export async function resetPasswordAction(input: unknown): Promise<AuthActionState> {
  const missingEnv = missingSupabaseState();

  if (missingEnv) {
    return missingEnv;
  }

  const parsed = resetPasswordSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, message: "Passwords must match and be at least 8 characters." };
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      ok: false,
      message: "Open the reset link from your email again before setting a new password."
    };
  }

  const rateLimit = await consumeRateLimit({
    action: "auth.password_reset",
    userId: user.id,
    ipHash: await getClientIpHashFromHeaders()
  });
  if (!rateLimit.allowed) {
    return { ok: false, message: rateLimitMessage(rateLimit.resetAt) };
  }

  const { error } = await supabase.auth.updateUser({
    password: parsed.data.password
  });

  if (error) return { ok: false, message: "Your password could not be updated. Request a new reset link and try again." };

  const { error: signOutError } = await supabase.auth.signOut({ scope: "global" });
  if (signOutError) {
    logBackendEvent("error", {
      action: "auth.password_reset_session_revoke",
      statusCode: 500,
      userId: user.id,
      errorType: errorType(signOutError)
    });
    await supabase.auth.signOut({ scope: "local" });
    return {
      ok: false,
      message: "Your password was changed, but not every session could be closed. Contact support before continuing."
    };
  }

  return { ok: true, message: "Password updated. You can now log in with the new password.", redirectTo: "/login" };
}

export async function logoutAction(input?: unknown) {
  const missingEnv = missingSupabaseState();

  if (!missingEnv) {
    const supabase = await createSupabaseServerClient();
    const parsed = logoutSchema.safeParse(input);
    const {
      data: { user }
    } = await supabase.auth.getUser();
    const endpoint = parsed.success ? parsed.data.pushEndpoint : null;
    if (user && endpoint) {
      const { error } = await supabase
        .from("push_subscriptions")
        .delete()
        .eq("user_id", user.id)
        .eq("endpoint", endpoint);
      if (error) {
        logBackendEvent("error", {
          action: "auth.logout_push_cleanup",
          statusCode: 500,
          userId: user.id,
          errorType: errorType(error)
        });
      }
    }
    await supabase.auth.signOut();
  }

  redirect("/");
}
