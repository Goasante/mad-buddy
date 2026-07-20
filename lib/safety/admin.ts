import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type SafetyAdminContext =
  | {
      ok: true;
      userId: string;
      email: string;
      isDevelopmentFallback: boolean;
    }
  | {
      ok: false;
      reason: "signed_out" | "not_allowed";
      email?: string;
    };

function allowedAdminEmails() {
  return new Set(
    (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
  );
}

function getEnvAdminEmailAccess(email: string) {
  const allowedEmails = allowedAdminEmails();

  if (allowedEmails.has(email.trim().toLowerCase())) {
    return { ok: true, isDevelopmentFallback: false };
  }

  return { ok: false, isDevelopmentFallback: false };
}

export async function getAdminEmailAccess(email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  const envAccess = getEnvAdminEmailAccess(normalizedEmail);

  if (envAccess.ok) return envAccess;

  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("admin_users")
      .select("email, disabled_at")
      .eq("email", normalizedEmail)
      .maybeSingle();

    if (error) {
      return envAccess;
    }

    return {
      ok: Boolean(data && !data.disabled_at),
      isDevelopmentFallback: false
    };
  } catch {
    return envAccess;
  }
}

export async function getSafetyAdminContext(): Promise<SafetyAdminContext> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error
  } = await supabase.auth.getUser();

  if (error || !user?.email) {
    return { ok: false, reason: "signed_out" };
  }

  const email = user.email.toLowerCase();
  const access = await getAdminEmailAccess(email);

  if (access.ok) {
    return {
      ok: true,
      userId: user.id,
      email,
      isDevelopmentFallback: access.isDevelopmentFallback
    };
  }

  return { ok: false, reason: "not_allowed", email };
}

export async function requireSafetyAdmin() {
  const context = await getSafetyAdminContext();

  if (!context.ok) {
    throw new Error("Safety admin access required.");
  }

  return {
    context,
    admin: createSupabaseAdminClient()
  };
}
