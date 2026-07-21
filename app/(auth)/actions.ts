"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createRequestId, errorType, logBackendEvent } from "@/lib/observability/logger";
import {
  consumeRateLimit,
  getClientIpHashFromHeaders,
  rateLimitMessage
} from "@/lib/security/rate-limit";
import { getAdminEmailAccess } from "@/lib/safety/admin";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseBrowserEnv, getSupabaseServerEnv } from "@/lib/supabase/env";
import { PRIVACY_POLICY_VERSION } from "@/lib/legal/consent";

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
  .refine((data) => data.password === data.confirmPassword);

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

  const supabase = await createSupabaseServerClient();
  const { fullName, username, email, password } = parsed.data;
  // TODO(consent): Persist a PolicyConsentEvent through ConsentLogger after
  // consent_logs RLS, retention, and audit access are approved.
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/auth/callback`,
      data: {
        full_name: fullName,
        username
      }
    }
  });

  if (error) {
    logBackendEvent("warn", {
      requestId,
      action: "auth.signup",
      statusCode: 400,
      latencyMs: Date.now() - startedAt,
      errorType: error.name
    });
    return { ok: false, message: "Your account could not be created. Check the form and try again." };
  }

  // Supabase intentionally returns an obfuscated user for an existing email.
  // Keep this indistinguishable from a confirmation-required signup so the
  // action cannot be used to discover registered addresses.
  if (data.user && data.user.identities?.length === 0 && !data.session) {
    logBackendEvent("info", {
      requestId,
      action: "auth.signup",
      statusCode: 200,
      latencyMs: Date.now() - startedAt
    });
    return {
      ok: true,
      message: "Check your email to continue.",
      redirectTo: "/login"
    };
  }

  if (data.user) {
    // When email confirmation is required, signUp returns no session, so
    // auth.uid() is null for the rest of this request, the owner-only RLS
    // policies on these tables would silently reject an anon-client insert
    // (42501), leaving a confirmed user with no profile/subscription/prefs
    // rows at all. The service role bypasses RLS so bootstrap always
    // succeeds regardless of session state.
    const env = getSupabaseServerEnv();
    if (env.url && env.serviceRoleKey) {
      const admin = createSupabaseAdminClient();
      const [profileResult, subscriptionResult, preferencesResult] = await Promise.all([
        admin.from("profiles").upsert({
          user_id: data.user.id,
          full_name: fullName,
          username,
          is_onboarded: false
        }),
        admin.from("subscriptions").upsert({
          user_id: data.user.id,
          plan: "free",
          status: "free"
        }),
        admin.from("user_preferences").upsert({
          user_id: data.user.id
        })
      ]);

      for (const [label, result] of [
        ["profile", profileResult],
        ["subscription", subscriptionResult],
        ["preferences", preferencesResult]
      ] as const) {
        if (result.error) {
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

      // Sign-up must never depend on email delivery. When confirmation is
      // required (no session returned), confirm the address with the service
      // role so the new user is not stranded waiting for an email that may be
      // slow, rate-limited, or misdelivered. Getting people into the app is the
      // whole point of sign-up.
      if (!data.session) {
        const { error: confirmError } = await admin.auth.admin.updateUserById(data.user.id, {
          email_confirm: true
        });
        if (confirmError) {
          logBackendEvent("error", {
            requestId,
            action: "auth.signup",
            statusCode: 500,
            latencyMs: Date.now() - startedAt,
            userId: data.user.id,
            errorType: "email_confirm_failed"
          });
        }
      }
    } else {
      logBackendEvent("error", {
        requestId,
        action: "auth.signup",
        statusCode: 500,
        latencyMs: Date.now() - startedAt,
        userId: data.user.id,
        errorType: "missing_service_role_for_bootstrap"
      });
    }
  }

  // If confirmation was required (no session), sign the freshly-confirmed user
  // in now so they go straight into onboarding rather than a login wall.
  if (data.user && !data.session) {
    const { error: sessionError } = await supabase.auth.signInWithPassword({ email, password });
    if (!sessionError) {
      logBackendEvent("info", {
        requestId,
        action: "auth.signup",
        statusCode: 200,
        latencyMs: Date.now() - startedAt,
        userId: data.user.id
      });
      return { ok: true, message: "Account created. Continue onboarding.", redirectTo: "/onboarding" };
    }
    // Very rare: confirmed but couldn't establish a session. They can still log
    // in normally (the email is confirmed), so no one is locked out.
    logBackendEvent("warn", {
      requestId,
      action: "auth.signup",
      statusCode: 200,
      latencyMs: Date.now() - startedAt,
      userId: data.user.id,
      errorType: "auto_signin_failed"
    });
    return { ok: true, message: "Account created. Log in to continue.", redirectTo: "/login" };
  }

  logBackendEvent("info", {
    requestId,
    action: "auth.signup",
    statusCode: 200,
    latencyMs: Date.now() - startedAt,
    userId: data.user?.id
  });

  return {
    ok: true,
    message: "Account created. Continue onboarding.",
    redirectTo: "/onboarding"
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

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/auth/callback?next=/reset-password`
  });

  // Keep the response identical whether or not the address exists. The
  // provider error is intentionally not returned to avoid account discovery.
  if (error) {
    logBackendEvent("warn", { action: "auth.password_recovery", statusCode: 400, errorType: errorType(error) });
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
