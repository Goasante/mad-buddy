import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { deliverNotification } from "@/lib/notifications/server";
import type { Database, SubscriptionPlan, SubscriptionStatus } from "@/lib/supabase/database.types";
import { paidPlanToSubscriptionPlan, paystackPlanFromPlanCode, mapPaystackSubscriptionStatus } from "@/lib/paystack/subscriptions";
import { paystackPlans } from "@/lib/paystack/config";

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
  currency?: string | null;
  customer?: PaystackCustomerLike | null;
  authorization?: PaystackAuthorizationLike | null;
  subscription?: PaystackSubscriptionLike | null;
  planCode?: string | null;
};

export function appPlanFromPaystack(input: Pick<PaystackSyncInput, "plan" | "planCode" | "subscription">) {
  const subscriptionPlan = input.subscription?.plan;
  const suppliedPlanCode =
    input.planCode ??
    (typeof subscriptionPlan === "string" ? subscriptionPlan : subscriptionPlan?.plan_code);
  const planFromCode = paystackPlanFromPlanCode(suppliedPlanCode);

  if (suppliedPlanCode) return planFromCode;

  if (input.plan === "plus" || input.plan === "pro") {
    return paidPlanToSubscriptionPlan(input.plan);
  }

  if (input.plan === "buddy_plus" || input.plan === "buddy_pro") {
    return input.plan;
  }

  return "free";
}

export function validatePaystackSyncInput(input: PaystackSyncInput) {
  const plan = appPlanFromPaystack(input);
  if (plan === "free") throw new Error("Unrecognized Paystack plan.");

  const configured = plan === "buddy_plus" ? paystackPlans.plus : paystackPlans.pro;
  const metadataPlan =
    input.plan === "plus" || input.plan === "pro"
      ? paidPlanToSubscriptionPlan(input.plan)
      : input.plan;

  if (metadataPlan && metadataPlan !== plan) throw new Error("Paystack plan metadata does not match the billed plan.");
  if (input.amount != null && input.amount !== configured.amount) throw new Error("Paystack amount does not match the configured plan.");
  if (input.currency && input.currency.toUpperCase() !== configured.currency) throw new Error("Paystack currency is not supported.");

  const subscriptionPlan = input.subscription?.plan;
  const suppliedPlanCode =
    input.planCode ??
    (typeof subscriptionPlan === "string" ? subscriptionPlan : subscriptionPlan?.plan_code);
  if (!suppliedPlanCode && input.amount == null) throw new Error("Paystack plan could not be verified.");

  return plan;
}

export async function syncPaystackSubscription(
  admin: SupabaseClient<Database>,
  input: PaystackSyncInput
) {
  const plan = validatePaystackSyncInput(input);
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
      status: status === "free" ? "active" : status,
      current_period_start: paidAt.toISOString(),
      current_period_end: periodEnd.toISOString(),
      // A successful payment sync ends any grace window and un-cancels
      // (batch 10 §61): the renewal went through.
      grace_ends_at: null,
      cancel_at_period_end: false
    },
    { onConflict: "user_id" }
  );

  if (error) {
    throw new Error(error.message);
  }

  await deliverNotification(admin, {
    userId: input.userId,
    priority: "high",
    type: "subscription_update",
    title: "Subscription update",
    message: `Your ${planLabel(plan)} subscription is ${statusLabel(status)}.`
  });
}

export async function markPaystackSubscriptionStatus(
  admin: SupabaseClient<Database>,
  subscriptionCode: string | null | undefined,
  status: SubscriptionStatus,
  extra: { graceEndsAt?: string | null; cancelAtPeriodEnd?: boolean } = {}
) {
  if (!subscriptionCode) {
    return;
  }

  const update: Database["public"]["Tables"]["subscriptions"]["Update"] = { provider: "paystack", status };
  if ("graceEndsAt" in extra) update.grace_ends_at = extra.graceEndsAt;
  if (extra.cancelAtPeriodEnd !== undefined) update.cancel_at_period_end = extra.cancelAtPeriodEnd;

  const { error } = await admin
    .from("subscriptions")
    .update(update)
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
