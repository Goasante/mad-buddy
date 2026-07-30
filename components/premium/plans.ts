import { PLAN_ENTITLEMENTS, type BooleanEntitlementKey } from "@/lib/billing/entitlements";
import {
  capabilitiesAddedBy,
  capabilityLabel,
  formatEntitlementAmount,
  HEADLINE_LIMITS
} from "@/lib/billing/upgrade-copy";
import type { SubscriptionPlan } from "@/lib/supabase/database.types";

// Prices live in lib/billing/pricing.ts and are re-exported here so existing
// importers keep working. Defining them in this component module created an
// import cycle once the plan cards started deriving from the billing layer.
export { planDisplayPrices, PLAN_BILLING_INTERVAL } from "@/lib/billing/pricing";
export type { PlanId } from "@/lib/billing/pricing";
import { planDisplayPrices, type PlanId } from "@/lib/billing/pricing";

export type PricingPlan = {
  id: PlanId;
  name: string;
  price: string;
  description: string;
  badge?: string;
  features: string[];
  limits: string[];
};

/**
 * Plan cards, DERIVED from the canonical entitlement registry.
 *
 * The previous hand-written copy had drifted badly from configuration and was
 * actively wrong: it advertised "Up to 25 friends" on Free (the registry says
 * 30), "Unlimited friends" on Plus (Plus is 150; only Pro is unlimited), "Up to
 * 10 friend requests daily" on Free (20), and "Up to 100 friend requests daily"
 * on Pro (Pro inherits 50). It also never mentioned Spotlight publishing at all,
 * which is one of the most concrete reasons to upgrade.
 *
 * Deriving the limits and capabilities means a tier change flows through
 * automatically instead of leaving stale marketing text behind, and nothing here
 * can claim a benefit the product does not actually grant. Prices stay in
 * `planDisplayPrices`, which remains the single display-price source.
 */
function limitLines(plan: SubscriptionPlan): string[] {
  return HEADLINE_LIMITS.map(
    ({ key, label }) => `${label}: ${formatEntitlementAmount(PLAN_ENTITLEMENTS[plan][key])}`
  );
}

function capabilityLines(plan: SubscriptionPlan): string[] {
  return capabilitiesAddedBy(plan)
    .map(capabilityLabel)
    .filter((entry): entry is string => entry !== null);
}

export const pricingPlans: PricingPlan[] = [
  {
    id: "free",
    name: "Free",
    price: planDisplayPrices.free,
    description: "Everything you need to find your Muddies and make plans.",
    features: [
      "Nearby glow with approved Muddies",
      "Private Moments with your Muddies",
      "View Spotlight",
      "Safe Arrival check-ins",
      "Ghost Mode"
    ],
    limits: limitLines("free")
  },
  {
    id: "plus",
    name: "Buddy Plus",
    price: planDisplayPrices.plus,
    description: "More room to connect, and more ways to personalise.",
    badge: "Most popular",
    features: ["Everything in Free", ...capabilityLines("buddy_plus")],
    limits: limitLines("buddy_plus")
  },
  {
    id: "pro",
    name: "Buddy Pro",
    price: planDisplayPrices.pro,
    description: "Publish to Spotlight and get the fullest Mad Buddy.",
    badge: "Most flexible",
    // capabilityLines puts "Publish images to Spotlight" here automatically,
    // because public_moments is the entitlement Pro adds.
    features: ["Everything in Buddy Plus", ...capabilityLines("buddy_pro")],
    limits: limitLines("buddy_pro")
  }
];

/**
 * Comparison table rows. Numeric rows read straight from the registry, and
 * capability rows from the same booleans the app enforces, so the table cannot
 * claim something the entitlement check would refuse.
 */
const COMPARISON_CAPABILITIES: { key: BooleanEntitlementKey; feature: string }[] = [
  { key: "public_moments", feature: "Publish to Spotlight" },
  { key: "custom_glow_styles", feature: "Custom glow styles" },
  { key: "advanced_visibility_schedules", feature: "Scheduled visibility" },
  { key: "recurring_plans", feature: "Recurring plans" },
  { key: "event_circle_creation", feature: "Create event circles" },
  { key: "event_drops", feature: "Event Drops" },
  { key: "friendship_recaps", feature: "Friendship recaps" },
  { key: "qr_check_in", feature: "QR check-in" },
  { key: "community_analytics", feature: "Community analytics" },
  { key: "priority_support", feature: "Priority support" }
];

export const comparisonRows: { feature: string; free: boolean | string; plus: boolean | string; pro: boolean | string }[] = [
  ...HEADLINE_LIMITS.map(({ key, label }) => ({
    feature: label,
    free: formatEntitlementAmount(PLAN_ENTITLEMENTS.free[key]),
    plus: formatEntitlementAmount(PLAN_ENTITLEMENTS.buddy_plus[key]),
    pro: formatEntitlementAmount(PLAN_ENTITLEMENTS.buddy_pro[key])
  })),
  ...COMPARISON_CAPABILITIES.map(({ key, feature }) => ({
    feature,
    free: PLAN_ENTITLEMENTS.free[key],
    plus: PLAN_ENTITLEMENTS.buddy_plus[key],
    pro: PLAN_ENTITLEMENTS.buddy_pro[key]
  }))
];
