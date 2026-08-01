import type { SubscriptionPlan } from "@/lib/supabase/database.types";

export type PremiumBadgeIdentity = {
  label: "Buddy Plus" | "Buddy Pro";
  shortLabel: "Plus" | "Pro";
  tier: "plus" | "pro";
};

export function premiumBadgeIdentity(plan: SubscriptionPlan | null | undefined): PremiumBadgeIdentity | null {
  if (plan === "buddy_plus") return { label: "Buddy Plus", shortLabel: "Plus", tier: "plus" };
  if (plan === "buddy_pro") return { label: "Buddy Pro", shortLabel: "Pro", tier: "pro" };
  return null;
}

