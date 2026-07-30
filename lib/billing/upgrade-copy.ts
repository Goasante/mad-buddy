import { PLAN_ENTITLEMENTS, UNLIMITED, type BooleanEntitlementKey, type NumericEntitlementKey } from "@/lib/billing/entitlements";
import { planDisplayPrices, PLAN_BILLING_INTERVAL, type PlanId } from "@/lib/billing/pricing";
import type { SubscriptionPlan } from "@/lib/supabase/database.types";

/**
 * Upgrade copy derived from canonical billing data.
 *
 * Exists so no feature component ever writes a price, a plan name or a benefit
 * of its own. Everything here is computed from `PLAN_ENTITLEMENTS` (the
 * entitlement registry) and `planDisplayPrices` (the single display-price
 * source), which means a tier change or a price change flows through
 * automatically instead of leaving stale marketing text behind.
 *
 * Pure and I/O-free: it describes the PLAN configuration, not a particular
 * user's entitlement. A caller that needs a specific user's access still resolves
 * that server-side through `resolveUserEntitlements`, which honours admin
 * overrides and billing grace.
 */

const PLAN_ORDER: SubscriptionPlan[] = ["free", "buddy_plus", "buddy_pro"];

const PLAN_LABELS: Record<SubscriptionPlan, string> = {
  free: "Free",
  buddy_plus: "Buddy Plus",
  buddy_pro: "Buddy Pro"
};

const PLAN_ID_BY_PLAN: Record<SubscriptionPlan, PlanId> = {
  free: "free",
  buddy_plus: "plus",
  buddy_pro: "pro"
};

export function planLabel(plan: SubscriptionPlan): string {
  return PLAN_LABELS[plan];
}

export function planPrice(plan: SubscriptionPlan): string {
  return planDisplayPrices[PLAN_ID_BY_PLAN[plan]];
}

/**
 * The cheapest plan that actually grants a boolean capability.
 *
 * Derived rather than assumed: if the registry moved a capability to a different
 * tier, this follows it. Returns null when no plan grants it, so a caller shows
 * nothing rather than inventing an upsell.
 */
export function cheapestPlanGranting(key: BooleanEntitlementKey): SubscriptionPlan | null {
  return PLAN_ORDER.find((plan) => PLAN_ENTITLEMENTS[plan][key] === true) ?? null;
}

/** Formats a numeric entitlement for display, honouring the unlimited sentinel. */
export function formatEntitlementAmount(value: number): string {
  return value === UNLIMITED || !Number.isFinite(value) ? "Unlimited" : value.toLocaleString();
}

/**
 * Boolean capabilities a plan adds that the plan BELOW it does not have, in
 * catalogue order. Used to describe what an upgrade actually buys without
 * hand-writing a feature list per plan.
 */
export function capabilitiesAddedBy(plan: SubscriptionPlan): BooleanEntitlementKey[] {
  const index = PLAN_ORDER.indexOf(plan);
  if (index <= 0) return [];
  const previous = PLAN_ENTITLEMENTS[PLAN_ORDER[index - 1]];
  const current = PLAN_ENTITLEMENTS[plan];
  return (Object.keys(current) as (keyof typeof current)[]).filter(
    (key): key is BooleanEntitlementKey => typeof current[key] === "boolean" && current[key] === true && previous[key] === false
  );
}

/** Human labels for the boolean capabilities that are worth naming in copy. */
const CAPABILITY_LABELS: Partial<Record<BooleanEntitlementKey, string>> = {
  public_moments: "Publish images to Air",
  advanced_visibility_schedules: "Scheduled visibility and Ghost Mode",
  recurring_plans: "Recurring plans",
  multiple_plan_polls: "Multiple polls per plan",
  custom_glow_styles: "Custom glow styles",
  friendship_recaps: "Friendship recaps",
  event_circle_creation: "Create event circles",
  event_drops: "Event Drops",
  qr_check_in: "QR check-in",
  attendance_export: "Attendance export",
  community_roles: "Community roles",
  moderation_dashboard: "Moderation tools",
  community_analytics: "Community analytics",
  priority_support: "Priority support"
};

export function capabilityLabel(key: BooleanEntitlementKey): string | null {
  return CAPABILITY_LABELS[key] ?? null;
}

/**
 * The cheapest PAID plan's display price, for "from as low as" copy.
 *
 * Derived from the plan order rather than assumed to be Plus, so a pricing or
 * tier change cannot leave the phrase quoting a price that is no longer the
 * cheapest upgrade.
 */
export function cheapestPaidPrice(): string {
  const paid = PLAN_ORDER.filter((plan) => plan !== "free");
  return planPrice(paid[0] ?? "buddy_plus");
}

/** Numeric limits worth showing on a plan card, in the order they should appear. */
export const HEADLINE_LIMITS: { key: NumericEntitlementKey; label: string }[] = [
  { key: "max_muddies", label: "Muddies" },
  { key: "max_close_friends", label: "Close Friends" },
  { key: "max_active_plans", label: "Active plans" },
  { key: "max_daily_moments", label: "Moments a day" },
  { key: "max_safe_arrival_contacts", label: "Safe Arrival contacts" },
  { key: "max_personal_circles", label: "Personal circles" }
];

export type SpotlightUpgradeCopy = {
  /** Null when the current configuration grants publishing to everyone. */
  plan: SubscriptionPlan | null;
  body: string;
  cta: string;
  /** Omitted unless the shown price really is the cheapest granting plan. */
  priceNote: string | null;
  benefits: string[];
};

/**
 * The Air (public Moments) upgrade explanation. Type/function names keep the
 * internal "spotlight" identifier for continuity with the rest of the codebase;
 * only the user-facing copy says "Air".
 *
 * Names the plan that actually grants `public_moments` and quotes its real
 * display price. The "from as low as" phrasing is only used when the cheapest
 * granting plan IS the plan being shown, so it can never imply a discount or a
 * cheaper route that does not exist.
 */
export function spotlightUpgradeCopy(): SpotlightUpgradeCopy {
  const plan = cheapestPlanGranting("public_moments");
  if (!plan) {
    return {
      plan: null,
      body: "Air publishing isn't available right now.",
      cta: "See plans",
      priceNote: null,
      benefits: []
    };
  }

  const label = PLAN_LABELS[plan];
  const price = planPrice(plan);
  const benefits = capabilitiesAddedBy(plan)
    .map(capabilityLabel)
    .filter((entry): entry is string => entry !== null)
    .slice(0, 4);

  return {
    plan,
    body: `With ${label} you can publish images to Air, reach people across Mad Buddy, and grow your Tune In audience.`,
    cta: `See ${label}`,
    // Cheapest granting plan by construction, since that is what
    // cheapestPlanGranting returns.
    priceNote: `Upgrade from as low as ${price} a ${PLAN_BILLING_INTERVAL}.`,
    benefits
  };
}
