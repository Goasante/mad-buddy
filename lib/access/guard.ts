import "server-only";

import { resolveAccessForUser, type AccessState } from "@/lib/access/resolver";

/**
 * LEGACY ACCESS-SURFACE COMPATIBILITY.
 *
 * Mad Buddy's monetization model is now ads-first: Linkr and UpFor are part of
 * the free product, while Mad Buddy Access removes advertising. Older call
 * sites still invoke checkAccess()/requireAccess() around Linkr and UpFor. We
 * deliberately keep this tiny compatibility layer while those dead gates are
 * removed in follow-up cleanup so the product change can ship without a risky
 * all-at-once rewrite of safety-sensitive discovery code.
 *
 * IMPORTANT: this module DOES NOT decide whether somebody is ad-free. That
 * decision belongs to lib/access/ad-entitlement.ts and is derived from the
 * canonical resolver below. Do not add a new premium boolean here.
 */

/** Retained only so existing callers compile while the old paywall is removed. */
export type PaidSurface = "linkr" | "upfor";

export type AccessDenied = {
  ok: false;
  reason: "access_required";
  surface: PaidSurface;
  message: string;
  hadWelcomeAccess: boolean;
};

export type AccessGranted = { ok: true; access: AccessState };
export type AccessResult = AccessGranted | AccessDenied;

/**
 * Linkr and UpFor are no longer paywalled.
 *
 * We still resolve the real Access state so callers that inspect the returned
 * object receive canonical subscription/grant information. The result is
 * always ok: true, including when access.hasAccess === false.
 */
export async function checkAccess(userId: string, _surface: PaidSurface): Promise<AccessResult> {
  const access = await resolveAccessForUser(userId);
  return { ok: true, access };
}

/**
 * Kept for source compatibility with any service that previously expected the
 * throwing form. Since Linkr and UpFor are free, this no longer throws for a
 * missing Access entitlement.
 */
export class AccessRequiredError extends Error {
  readonly reason = "access_required" as const;
  readonly surface: PaidSurface;
  readonly hadWelcomeAccess: boolean;

  constructor(denial: AccessDenied) {
    super(denial.message);
    this.name = "AccessRequiredError";
    this.surface = denial.surface;
    this.hadWelcomeAccess = denial.hadWelcomeAccess;
  }
}

export async function requireAccess(userId: string, surface: PaidSurface): Promise<AccessState> {
  const result = await checkAccess(userId, surface);
  if (!result.ok) throw new AccessRequiredError(result);
  return result.access;
}

/**
 * Did this account ever hold Welcome Access, whatever its state now?
 *
 * Welcome Access remains meaningful under the ads-first model: while active it
 * gives the account the same ad-free state as any other valid Access source.
 */
export async function hasEverHadWelcomeAccess(userId: string): Promise<boolean> {
  const { createSupabaseAdminClient } = await import("@/lib/supabase/admin");
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("access_grants")
    .select("id")
    .eq("user_id", userId)
    .eq("source", "welcome_access")
    .limit(1);
  return (data ?? []).length > 0;
}
