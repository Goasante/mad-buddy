import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createNotification } from "@/lib/notifications/server";
import type { Database, SubscriptionPlan, SubscriptionStatus } from "@/lib/supabase/database.types";
import { paidPlanToSubscriptionPlan, paystackPlanFromPlanCode, mapPaystackSubscriptionStatus } from "@/lib/paystack/subscriptions";

type PaystackCustomerLike = {
  customer_code?: string;
  email?: string;
};

type PaystackAuthorizationLike = {
  authorization_code?: string;
};

type PaystackPlanLike = string | { plan_code?: string };

type PaystackSubscriptionLike = {
  subscription_code?: string;
  email_token?: string;
  status?: string;
  next_payment_date?: string | null;
  customer?: PaystackCustomerLike;
  plan?: PaystackPlanLike;
};

export type PaystackSyncInput = {
  userId: string;
  plan?: "plus" | "pro" | SubscriptionPlan | null;
  status?: string | null;
  reference?: string | null;
  paidAt?: string | null;
  amount?: number | null;
  customer?: PaystackCustomerLike | null;
  authorization?: PaystackAuthorizationLike | null;
  subscription?: PaystackSubscriptionLike | null;
  planCode?: string | null;
};

export function appPlanFromPaystack(input: Pick<PaystackSyncInput, "plan" | "planCode" | "subscription">) {
  if (input.plan === "plus" || input.plan === "pro") {
    return paidPlanToSubscriptionPlan(input.plan);
  }

  if (input.plan === "buddy_plus" || input.plan === "buddy_pro") {
    return input.plan;
  }

  const subscriptionPlan = input.subscription?.plan;
  const planCode =
    input.planCode ??
    (typeof subscriptionPlan === "string" ? subscriptionPlan : subscriptionPlan?.plan_code);

  return paystackPlanFromPlanCode(planCode);
}

export async function syncPaystackSubscription(
  admin: SupabaseClient<Database>,
  input: PaystackSyncInput
) {
  const plan = appPlanFromPaystack(input);
  const status = mapPaystackSubscriptionStatus(input.subscription?.status ?? input.status);
  const paidAt = input.paidAt ? new Date(input.paidAt) : new Date();
  const periodEnd = input.subscription?.next_payment_date
    ? new Date(input.subscription.next_payment_date)
    : new Date(paidAt);

  if (!input.subscription?.next_payment_date) {
    periodEnd.setDate(periodEnd.getDate() + 30);
  }

  const customerCode = input.subscription?.customer?.customer_code ?? input.customer?.customer_code ?? null;
  const subscriptionCode = input.subscription?.subscription_code ?? null;
  const emailToken = input.subscription?.email_token ?? null;
  const authorizationCode = input.authorization?.authorization_code ?? null;

  const { error } = await admin.from("subscriptions").upsert(
    {
      user_id: input.userId,
      provider: "paystack",
      paystack_customer_code: customerCode,
      paystack_subscription_code: subscriptionCode,
      paystack_email_token: emailToken,
      paystack_authorization_code: authorizationCode,
      plan,
      status: status === "free" && plan !== "free" ? "active" : status,
      current_period_start: plan === "free" ? null : paidAt.toISOString(),
      current_period_end: plan === "free" ? null : periodEnd.toISOString()
    },
    { onConflict: "user_id" }
  );

  if (error) {
    throw new Error(error.message);
  }

  await createNotification(admin, {
    userId: input.userId,
    type: "subscription_update",
    title: "Subscription update",
    message: `Your ${planLabel(plan)} subscription is ${statusLabel(status)}.`
  });
}

export async function markPaystackSubscriptionStatus(
  admin: SupabaseClient<Database>,
  subscriptionCode: string | null | undefined,
  status: SubscriptionStatus
) {
  if (!subscriptionCode) {
    return;
  }

  const { error } = await admin
    .from("subscriptions")
    .update({ provider: "paystack", status })
    .eq("paystack_subscription_code", subscriptionCode);

  if (error) {
    throw new Error(error.message);
  }
}

function planLabel(plan: SubscriptionPlan) {
  if (plan === "buddy_plus") {
    return "Buddy Plus";
  }

  if (plan === "buddy_pro") {
    return "Buddy Pro";
  }

  return "Free";
}

function statusLabel(status: SubscriptionStatus) {
  return status.replace("_", " ");
}
