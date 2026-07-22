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
import { getSupabaseBrowserEnv, getSupabaseServerEnv } from "@/lib/supabase/env";
import { PRIVACY_POLICY_VERSION } from "@/lib/legal/consent";
import { validateUsername } from "@/lib/profile/rules";

export type AuthActionState = {
  ok: boolean;
  message: string;
  redirectTo?: "/login" | "/dashboard" | "/onboarding" | "/admin";
};

const signupSchema = z
  .object({
    fullName: z.string().min(2),
    username: z
      .string()
      .min(3)
      .max(24)
      .regex(/^[a-z0-9_]+$/),
    email: z.string().email(),
    password: z.string().min(8),
    confirmPassword: z.string().min(8),
    acceptedPolicy: z.literal(true),
    policyVersion: z.literal(PRIVACY_POLICY_VERSION)
  })
  .superRefine((data, context) => {
    if (data.password !== data.confirmPassword) {
      context.addIssue({ code: "custom", path: ["confirmPassword"], message: "Passwords do not match." });
    }
    const usernameError = validateUsername(data.username);
    if (usernameError) context.addIssue({ code: "custom", path: ["username"], message: usernameError });
  });

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  rememberMe: z.boolean()
});

const forgotPasswordSchema = z.object({
  email: z.string().email()
});

const resetPasswordSchema = z
  .object({
    password: z.string().min(8),
    confirmPassword: z.string().min(8)
  })
  .refine((data) => data.password === data.confirmPassword);

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

  const { fullName, username, email, password } = parsed.data;

  const env = getSupabaseServerEnv();
  if (!env.url || !env.serviceRoleKey) {
    logBackendEvent("error", {
      requestId,
      action: "auth.signup",
      statusCode: 500,
      latencyMs: Date.now() - startedAt,
      errorType: "missing_service_role"
    });
    return { ok: false, message: "Sign-up is temporarily unavailable. Please try again shortly." };
  }
  const admin = createSupabaseAdminClient();

  // Create a pre-confirmed account with the admin API. This never sends a
  // confirmation email, so sign-up can't be blocked by the provider's email
  // rate limit — the built-in SMTP allows only a few messages per hour, and once
  // it was exhausted `auth.signUp` failed outright, so real sign-ups silently
  // created no account and those users then hit "wrong password" on login. The
  // app already auto-confirms and never uses the email link, so email delivery
  // must never gate sign-up. Mirrors the mobile /api/auth/signup path.
  // TODO(consent): Persist a PolicyConsentEvent through ConsentLogger after
  // consent_logs RLS, retention, and audit access are approved.
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, username }
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
      return { ok: true, message: "Check your email to continue.", redirectTo: "/login" };
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

  // Per-user rows (profile / subscription / preferences). Idempotent; shared
  // with the mobile path (lib/auth/bootstrap) so the two can't drift.
  const bootstrapResults = await bootstrapNewUser(admin, { userId: created.user.id, fullName, username });
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
          ? "That username is already taken. Try another one."
          : "Your account could not be set up. Please try again."
    };
  }

  // Establish the cookie session so they continue straight into onboarding. The
  // account is already confirmed, so a failure here is transient — and even then
  // the user can just log in, so no one is stranded.
  const supabase = await createSupabaseServerClient();
  const { error: sessionError } = await supabase.auth.signInWithPassword({ email, password });
  if (sessionError) {
    logBackendEvent("warn", {
      requestId,
      action: "auth.signup",
      statusCode: 200,
      latencyMs: Date.now() - startedAt,
      userId: created.user.id,
      errorType: "auto_signin_failed"
    });
    return { ok: true, message: "Account created. Log in to continue.", redirectTo: "/login" };
  }

  logBackendEvent("info", {
    requestId,
    action: "auth.signup",
    statusCode: 200,
    latencyMs: Date.now() - startedAt,
    userId: created.user.id
  });
  return { ok: true, message: "Account created. Continue onboarding.", redirectTo: "/onboarding" };
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

  return { ok: true, message: "Logged in.", redirectTo: "/dashboard" };
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

  return { ok: true, message: "Admin login successful.", redirectTo: "/admin" };
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

  return { ok: true, message: "Password updated. You can now log in with the new password.", redirectTo: "/login" };
}

export async function logoutAction() {
  const missingEnv = missingSupabaseState();

  if (!missingEnv) {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
  }

  redirect("/");
}
