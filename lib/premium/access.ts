import "server-only";

import type { SubscriptionPlan } from "@/lib/supabase/database.types";
import { isPremiumSubscription } from "@/lib/paystack/subscriptions";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const planRank: Record<SubscriptionPlan, number> = {
  free: 0,
  buddy_plus: 1,
  buddy_pro: 2
};

export async function getCurrentSubscriptionAccess(userId: string) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("subscriptions")
    .select("plan, status")
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !data) {
    return { plan: "free" as const, status: "free" as const, hasPremium: false };
  }

  return {
    plan: data.plan,
    status: data.status,
    hasPremium: isPremiumSubscription(data.status, data.plan)
  };
}

export async function requirePremiumPlan(userId: string, requiredPlan: Exclude<SubscriptionPlan, "free">) {
  const access = await getCurrentSubscriptionAccess(userId);

  if (!access.hasPremium || planRank[access.plan] < planRank[requiredPlan]) {
    throw new Error(`${requiredPlan} subscription required.`);
  }

  return access;
}
