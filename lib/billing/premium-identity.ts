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

/**
 * The only membership fact any public surface may carry: the EFFECTIVE tier.
 *
 * Deliberately narrow. It says what someone has, never how they got it —
 * paid, trial, earned reward and admin grant all collapse to the same three
 * values, so a viewer cannot tell a trialling user from a paying one, and no
 * billing provider, payment status, renewal date, reward id or override
 * detail can ride along.
 *
 * Always derive this from a server-resolved SubscriptionPlan (effectivePlan /
 * loadEffectivePlan / loadEffectivePlansForUsers), which already applies the
 * paid → trial → earned precedence and expiry. Never from client state, and
 * never from a boolean "is premium" flag: a boolean cannot distinguish plus
 * from pro, and guessing would show the wrong ring.
 */
export type PublicMembershipTier = "free" | "plus" | "pro";

/** Maps a server-resolved effective plan to its public tier. */
export function publicMembershipTier(plan: SubscriptionPlan | null | undefined): PublicMembershipTier {
  const identity = premiumBadgeIdentity(plan);
  return identity ? identity.tier : "free";
}

/** Accessible text for a tier, for surfaces that must not rely on colour alone. */
export function membershipTierLabel(tier: PublicMembershipTier): string | null {
  if (tier === "pro") return "Buddy Pro member";
  if (tier === "plus") return "Buddy Plus member";
  return null;
}

