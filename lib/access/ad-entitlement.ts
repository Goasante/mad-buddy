import "server-only";

import { resolveAccessForUser, type AccessState, type AccessSource } from "@/lib/access/resolver";

export type AdEntitlement = {
  /** True means no advertising may be requested or rendered for this account. */
  adFree: boolean;
  /** Mirrors the canonical Access state for account/settings surfaces. */
  hasAccess: boolean;
  primarySource: AccessSource | null;
  expiresAt: string | null;
  daysRemaining: number | null;
};

/**
 * Pure projection kept separate for tests and for future native consumers.
 *
 * There is intentionally no second subscription query, profile flag, or
 * client-owned preference. Mad Buddy Access is the one entitlement authority;
 * advertising simply consumes its answer.
 */
export function adEntitlementFromAccess(access: AccessState): AdEntitlement {
  return {
    adFree: access.hasAccess,
    hasAccess: access.hasAccess,
    primarySource: access.primarySource,
    expiresAt: access.expiresAt,
    daysRemaining: access.daysRemaining
  };
}

export async function resolveAdEntitlementForUser(userId: string): Promise<AdEntitlement> {
  return adEntitlementFromAccess(await resolveAccessForUser(userId));
}
