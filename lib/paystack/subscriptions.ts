import "server-only";

import type { SubscriptionPlan, SubscriptionStatus } from "@/lib/supabase/database.types";
import { paystackPlans, type PaidPlanId } from "@/lib/paystack/config";

const activeStatuses: SubscriptionStatus[] = ["active"];

export function paystackPlanFromPlanCode(planCode: string | null | undefined): SubscriptionPlan {
  if (planCode && planCode === paystackPlans.plus.planCode) {
    return "buddy_plus";
  }

  if (planCode && planCode === paystackPlans.pro.planCode) {
    return "buddy_pro";
  }

  return "free";
}

export function paidPlanToSubscriptionPlan(plan: PaidPlanId): Exclude<SubscriptionPlan, "free"> {
  return plan === "plus" ? "buddy_plus" : "buddy_pro";
}

export function mapPaystackSubscriptionStatus(value: string | null | undefined): SubscriptionStatus {
  const normalized = value?.toLowerCase();

  if (normalized === "active" || normalized === "success") {
    return "active";
  }

  if (normalized === "non-renewing" || normalized === "non_renewing") {
    return "non_renewing";
  }

  if (normalized === "attention") {
    return "attention";
  }

  if (normalized === "cancelled" || normalized === "canceled" || normalized === "disabled") {
    return "cancelled";
  }

  if (normalized === "expired") {
    return "expired";
  }

  return "free";
}

export function isPremiumSubscription(status: SubscriptionStatus, plan: SubscriptionPlan) {
  return activeStatuses.includes(status) && (plan === "buddy_plus" || plan === "buddy_pro");
}
