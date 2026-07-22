import "server-only";

import { effectivePlan } from "@/lib/billing/entitlements";
import { refreshTierOverrides } from "@/lib/billing/tier-overrides-loader";
import { loadBillingState } from "@/lib/billing/service";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { SubscriptionPlan } from "@/lib/supabase/database.types";

const planRank: Record<SubscriptionPlan, number> = {
  free: 0,
  buddy_plus: 1,
  buddy_pro: 2
};

/**
 * Resolves through the batch-10 billing state rather than reading
 * `subscriptions.plan` raw, so every existing call site honours grace
 * periods and expiry (spec §61, §62): a past_due user inside their grace
 * window keeps paid access; an expired one is free even if the provider
 * status hasn't caught up.
 */
export async function getCurrentSubscriptionAccess(userId: string) {
  const admin = createSupabaseAdminClient();
  // Keep the tier-override cache warm so the sync entitlementsFor() calls that
  // follow in this request reflect any admin edits.
  await refreshTierOverrides(admin);
  const state = await loadBillingState(admin, userId);
  const plan = effectivePlan(state, Date.now());

  return {
    plan,
    status: state.status,
    hasPremium: plan !== "free"
  };
}

export async function requirePremiumPlan(userId: string, requiredPlan: Exclude<SubscriptionPlan, "free">) {
  const access = await getCurrentSubscriptionAccess(userId);

  if (!access.hasPremium || planRank[access.plan] < planRank[requiredPlan]) {
    throw new Error(`${requiredPlan} subscription required.`);
  }

  return access;
}
