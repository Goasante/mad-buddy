import type { SubscriptionPlan } from "@/lib/supabase/database.types";

/** Retained only as a compatibility type. Access is permission, not social status. */
export type PremiumBadgeIdentity = {
  label: "Buddy Plus" | "Buddy Pro";
  shortLabel: "Plus" | "Pro";
  tier: "plus" | "pro";
};
export function premiumBadgeIdentity(_plan: SubscriptionPlan | null | undefined): PremiumBadgeIdentity | null { return null; }
export type PublicMembershipTier = "free" | "plus" | "pro";
export function publicMembershipTier(_plan: SubscriptionPlan | null | undefined): PublicMembershipTier { return "free"; }
export function membershipTierLabel(_tier: PublicMembershipTier): string | null { return null; }
