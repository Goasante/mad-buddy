import type { BillingState, Entitlements } from "@/lib/billing/entitlements";
import { billingAccessSource, effectivePlan, UNLIMITED } from "@/lib/billing/entitlements";
import type { UsageSnapshot } from "@/lib/billing/service";
import type { SubscriptionPlan } from "@/lib/supabase/database.types";

export const MEMBERSHIP_PLAN_LABELS: Record<SubscriptionPlan, string> = {
  free: "Free",
  buddy_plus: "Buddy Plus",
  buddy_pro: "Buddy Pro"
};

export type MembershipIdentity = {
  plan: SubscriptionPlan;
  planLabel: string;
  source: ReturnType<typeof billingAccessSource>;
  sourceLabel: string;
  statusLabel: string;
  dateLabel: string | null;
  dateMs: number | null;
};

/**
 * Presentation-only membership identity derived from the same authoritative
 * billing state used by entitlement enforcement. It never infers access from
 * a client value and never changes a subscription, trial or earned reward.
 */
export function resolveMembershipIdentity(state: BillingState, nowMs: number): MembershipIdentity {
  const plan = effectivePlan(state, nowMs);
  const source = billingAccessSource(state, nowMs);

  if (source === "trial") {
    return {
      plan,
      planLabel: MEMBERSHIP_PLAN_LABELS[plan],
      source,
      sourceLabel: "Premium trial",
      statusLabel: "Trial active",
      dateLabel: "Trial ends",
      dateMs: state.trialEndsAtMs ?? null
    };
  }

  if (source === "earned") {
    const inGrace = (state.earnedEndsAtMs ?? 0) <= nowMs && (state.earnedGraceEndsAtMs ?? 0) > nowMs;
    return {
      plan,
      planLabel: MEMBERSHIP_PLAN_LABELS[plan],
      source,
      sourceLabel: "Earned through your progress",
      statusLabel: inGrace ? "Grace period" : "Earned access",
      dateLabel: inGrace ? "Grace ends" : "Earned access ends",
      dateMs: inGrace ? (state.earnedGraceEndsAtMs ?? null) : (state.earnedEndsAtMs ?? null)
    };
  }

  if (source === "subscription") {
    const nonRenewing = state.status === "non_renewing" || state.status === "cancelled";
    const attention = state.status === "past_due" || state.status === "attention";
    return {
      plan,
      planLabel: MEMBERSHIP_PLAN_LABELS[plan],
      source,
      sourceLabel: "Paid membership",
      statusLabel: nonRenewing ? "Ends after current period" : attention ? "Payment needs attention" : "Active",
      dateLabel: attention && state.graceEndsMs ? "Grace ends" : nonRenewing ? "Access ends" : "Renews",
      dateMs: attention && state.graceEndsMs ? state.graceEndsMs : state.periodEndMs
    };
  }

  return {
    plan: "free",
    planLabel: MEMBERSHIP_PLAN_LABELS.free,
    source: "free",
    sourceLabel: "Included with Mad Buddy",
    statusLabel: "Active",
    dateLabel: null,
    dateMs: null
  };
}

export type MembershipUsageItem = {
  key: keyof UsageSnapshot;
  label: string;
  current: number;
  limit: number;
};

export function membershipUsageItems(usage: UsageSnapshot, entitlements: Entitlements): MembershipUsageItem[] {
  return [
    { key: "muddies", label: "Muddies", current: usage.muddies, limit: entitlements.max_muddies },
    {
      key: "personalCircles",
      label: "Personal circles",
      current: usage.personalCircles,
      limit: entitlements.max_personal_circles
    },
    {
      key: "closeFriends",
      label: "Close Friends",
      current: usage.closeFriends,
      limit: entitlements.max_close_friends
    },
    { key: "activePlans", label: "Active plans", current: usage.activePlans, limit: entitlements.max_active_plans },
    {
      key: "privateGroups",
      label: "Private groups",
      current: usage.privateGroups,
      limit: entitlements.max_private_groups
    }
  ];
}

export function membershipUsagePercent(current: number, limit: number): number {
  if (limit === UNLIMITED || !Number.isFinite(limit) || limit <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((current / limit) * 100)));
}

