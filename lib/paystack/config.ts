import "server-only";

import type { PlanId } from "@/components/premium/plans";

export type PaidPlanId = Exclude<PlanId, "free">;

export type PaystackPlanConfig = {
  appPlan: "buddy_plus" | "buddy_pro";
  amount: number;
  currency: "GHS";
  planCode?: string;
};

export const paystackPlans: Record<PaidPlanId, PaystackPlanConfig> = {
  plus: {
    appPlan: "buddy_plus",
    amount: 5000,
    currency: "GHS",
    planCode: process.env.PAYSTACK_BUDDY_PLUS_PLAN_CODE
  },
  pro: {
    appPlan: "buddy_pro",
    amount: 10000,
    currency: "GHS",
    planCode: process.env.PAYSTACK_BUDDY_PRO_PLAN_CODE
  }
};

export function getPaystackSecretKey() {
  return process.env.PAYSTACK_SECRET_KEY;
}

export function getPaystackWebhookSecret() {
  return process.env.PAYSTACK_WEBHOOK_SECRET ?? process.env.PAYSTACK_SECRET_KEY;
}

export function getPaystackPlan(plan: PaidPlanId) {
  return paystackPlans[plan];
}

export function getMissingPaystackConfig(plan?: PaidPlanId) {
  const missing: string[] = [];

  if (!process.env.PAYSTACK_SECRET_KEY) {
    missing.push("PAYSTACK_SECRET_KEY");
  }

  if (!process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY) {
    missing.push("NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY");
  }

  if (plan && !getPaystackPlan(plan).planCode) {
    missing.push(plan === "plus" ? "PAYSTACK_BUDDY_PLUS_PLAN_CODE" : "PAYSTACK_BUDDY_PRO_PLAN_CODE");
  }

  return missing;
}

export function getMissingPaystackWebhookConfig() {
  const missing = getMissingPaystackConfig();

  if (!getPaystackWebhookSecret()) {
    missing.push("PAYSTACK_WEBHOOK_SECRET");
  }

  return missing;
}

export function getAppUrl() {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}
