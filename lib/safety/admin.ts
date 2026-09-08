import "server-only";

import { getCurrentIdentity, getCurrentUserRecord } from "@/lib/supabase/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

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

/**
 * Whether to SHOW the Admin link, decided from verified identity.
 *
 * Presentation only. It grants nothing: every Admin route calls
 * `getSafetyAdminContext()` itself, so a stale answer here can at worst show
 * or hide a link to a page that will still refuse the caller on its own terms.
 *
 * It exists because the app layout renders on every page, and using the
 * authoritative context there imposed a network round trip app-wide for a
 * decision that only affects a menu item. Access is still authoritative
 * wherever it is actually granted.
 */
export async function getAdminLinkVisibility(): Promise<boolean> {
  const identity = await getCurrentIdentity();
  if (!identity?.email) return false;
  const access = await getAdminEmailAccess(identity.email.toLowerCase());
  return access.ok;
}

export async function getSafetyAdminContext(): Promise<SafetyAdminContext> {
  // Shares the per-request cached getUser() round trip with the layout and page.
  const user = await getCurrentUserRecord();

  if (!user?.email) {
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
