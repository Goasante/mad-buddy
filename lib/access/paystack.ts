import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  ACCESS_MANUAL_PERIOD_DAYS,
  MAD_BUDDY_ACCESS,
  type AccessPaymentMode
} from "@/lib/access/product";
import { deliverNotification } from "@/lib/notifications/server";
import type { Database } from "@/lib/supabase/database.types";

/**
 * PAYSTACK VERIFICATION FOR MAD BUDDY ACCESS.
 *
 * There are now two legitimate payment shapes for the SAME product:
 *
 * 1. recurring card subscription — tied to our Paystack plan code;
 * 2. Ghana Mobile Money — a one-time GHS 5.00 charge that buys 30 days.
 *
 * The second path deliberately has no plan code, so it must prove itself using
 * stronger one-time-payment facts: our exact product metadata, exact payment
 * mode, exact amount, exact GHS currency, and Paystack's `mobile_money` channel.
 * The webhook signature is checked before this module is called.
 */
export type AccessPaystackEvent = {
  /** Minor units, as Paystack sends it. */
  amount?: number | null;
  currency?: string | null;
  planCode?: string | null;
  /** `metadata.product` from checkout initialization, when present. */
  product?: string | null;
  /** Server-authored metadata from `/api/access/checkout`. */
  paymentMode?: AccessPaymentMode | string | null;
  /** Paystack's successful transaction channel, e.g. `card`, `mobile_money`. */
  channel?: string | null;
};

export type AccessVerification = { ok: true } | { ok: false; reason: string };

export function isAccessEvent(event: AccessPaystackEvent): boolean {
  if (MAD_BUDDY_ACCESS.planCode && event.planCode === MAD_BUDDY_ACCESS.planCode) return true;
  return event.product === MAD_BUDDY_ACCESS.id;
}

export function isManualMobileMoneyAccessEvent(event: AccessPaystackEvent): boolean {
  return event.paymentMode === "mobile_money_30d";
}

/**
 * Verify a Paystack event against server-owned product configuration.
 *
 * Recurring lifecycle events may legitimately omit amount/currency/metadata,
 * but they MUST carry our plan code. Mobile Money has no plan, so its successful
 * charge MUST carry all of the one-time-payment facts listed above.
 */
export function verifyAccessEvent(event: AccessPaystackEvent): AccessVerification {
  const expectedAmount = MAD_BUDDY_ACCESS.amountMinor;
  const expectedPlan = MAD_BUDDY_ACCESS.planCode;

  if (expectedAmount === null) {
    return { ok: false, reason: "Mad Buddy Access has no configured price." };
  }

  if (event.paymentMode === "mobile_money_30d") {
    if (event.product !== MAD_BUDDY_ACCESS.id) {
      return { ok: false, reason: "Mobile Money metadata does not name Mad Buddy Access." };
    }
    if (event.planCode) {
      return { ok: false, reason: "Mobile Money Access must not carry a recurring plan code." };
    }
    if (event.amount !== expectedAmount) {
      return { ok: false, reason: "Mobile Money amount does not match the configured price." };
    }
    if (!event.currency || event.currency.toUpperCase() !== MAD_BUDDY_ACCESS.currency) {
      return { ok: false, reason: "Mobile Money currency is not the configured GHS price." };
    }
    if (event.channel !== "mobile_money") {
      return { ok: false, reason: "Mobile Money Access was not paid through the Mobile Money channel." };
    }
    return { ok: true };
  }

  /* A metadata value we do not understand is a contradiction, not something to
     silently reinterpret as recurring card. */
  if (event.paymentMode && event.paymentMode !== "card_subscription") {
    return { ok: false, reason: "Paystack metadata names an unknown Access payment mode." };
  }

  if (expectedPlan === null) {
    return { ok: false, reason: "Mad Buddy Access recurring plan is not configured." };
  }
  if (!event.planCode) {
    return { ok: false, reason: "Paystack recurring event carries no plan code." };
  }
  if (event.planCode !== expectedPlan) {
    return { ok: false, reason: "Paystack plan code does not match Mad Buddy Access." };
  }

  if (event.amount != null && event.amount !== expectedAmount) {
    return { ok: false, reason: "Paystack amount does not match the configured price." };
  }
  if (event.currency && event.currency.toUpperCase() !== MAD_BUDDY_ACCESS.currency) {
    return { ok: false, reason: "Paystack currency does not match the configured price." };
  }
  if (event.product && event.product !== MAD_BUDDY_ACCESS.id) {
    return { ok: false, reason: "Paystack metadata names a different product." };
  }

  return { ok: true };
}

/** The provider-backed recurring period. */
export function accessPeriodEnd(nextPaymentDate: string | null | undefined, paidAt: Date): Date {
  if (nextPaymentDate) {
    const parsed = new Date(nextPaymentDate);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  const fallback = new Date(paidAt);
  fallback.setDate(fallback.getDate() + ACCESS_MANUAL_PERIOD_DAYS);
  return fallback;
}

/**
 * Record one verified Access row. `non_renewing` remains live through
 * `current_period_end`, which is exactly the state a manual Mobile Money period
 * needs: paid now, no automatic next charge.
 */
export async function recordAccessSubscription(
  admin: SupabaseClient<Database>,
  input: {
    userId: string;
    status: "active" | "trialing" | "past_due" | "non_renewing";
    periodStart: Date;
    periodEnd: Date;
    customerCode?: string | null;
    subscriptionCode?: string | null;
    emailToken?: string | null;
    authorizationCode?: string | null;
    cancelAtPeriodEnd?: boolean;
    /** Changes notification copy only; entitlement authority is still the row. */
    manualRenewal?: boolean;
  }
): Promise<void> {
  const { error } = await admin.from("subscriptions").upsert(
    {
      user_id: input.userId,
      provider: "paystack",
      plan: "mad_buddy_access",
      status: input.status,
      paystack_customer_code: input.customerCode ?? null,
      paystack_subscription_code: input.subscriptionCode ?? null,
      paystack_email_token: input.emailToken ?? null,
      paystack_authorization_code: input.authorizationCode ?? null,
      current_period_start: input.periodStart.toISOString(),
      current_period_end: input.periodEnd.toISOString(),
      grace_ends_at: null,
      cancel_at_period_end: input.cancelAtPeriodEnd ?? false
    },
    { onConflict: "user_id" }
  );

  if (error) throw new Error(`Could not record Access subscription: ${error.message}`);

  const manualEnd = input.periodEnd.toLocaleDateString("en-GH", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC"
  });

  await deliverNotification(admin, {
    userId: input.userId,
    priority: "high",
    type: "subscription_update",
    title: "Mad Buddy Access",
    message: input.manualRenewal
      ? `Your Mobile Money payment is confirmed. Mad Buddy Access is active through ${manualEnd}; pay again when you want another period.`
      : input.status === "active"
        ? "Your Mad Buddy Access is active. Linkr and UpFor are unlocked."
        : `Your Mad Buddy Access subscription is ${input.status}.`
  });
}

/**
 * Apply a verified one-time Mobile Money purchase.
 *
 * A second legitimate payment extends from the later of NOW or the end of an
 * existing MANUAL paid period, rather than silently replacing days the customer
 * already bought. Automatic card subscriptions are not stacked here: checkout
 * blocks a second paid purchase while one is live.
 */
export async function recordAccessManualPayment(
  admin: SupabaseClient<Database>,
  input: {
    userId: string;
    paidAt: Date;
    customerCode?: string | null;
  }
): Promise<{ periodStart: Date; periodEnd: Date }> {
  const { data: existing, error: existingError } = await admin
    .from("subscriptions")
    .select(
      "plan, status, current_period_start, current_period_end, paystack_customer_code, paystack_subscription_code"
    )
    .eq("user_id", input.userId)
    .maybeSingle();

  if (existingError) throw new Error(`Could not load existing Access period: ${existingError.message}`);

  const paidAtMs = input.paidAt.getTime();
  const existingEndMs = existing?.current_period_end ? Date.parse(existing.current_period_end) : Number.NaN;
  const existingIsManualAccess =
    existing?.plan === "mad_buddy_access" &&
    !existing.paystack_subscription_code &&
    ["active", "trialing", "past_due", "non_renewing"].includes(existing.status ?? "") &&
    Number.isFinite(existingEndMs) &&
    existingEndMs > paidAtMs;

  const base = new Date(existingIsManualAccess ? existingEndMs : paidAtMs);
  const periodEnd = new Date(base);
  periodEnd.setUTCDate(periodEnd.getUTCDate() + ACCESS_MANUAL_PERIOD_DAYS);

  const existingStart = existing?.current_period_start ? new Date(existing.current_period_start) : null;
  const periodStart =
    existingIsManualAccess && existingStart && !Number.isNaN(existingStart.getTime())
      ? existingStart
      : input.paidAt;

  await recordAccessSubscription(admin, {
    userId: input.userId,
    status: "non_renewing",
    periodStart,
    periodEnd,
    customerCode: input.customerCode ?? existing?.paystack_customer_code ?? null,
    subscriptionCode: null,
    emailToken: null,
    authorizationCode: null,
    cancelAtPeriodEnd: true,
    manualRenewal: true
  });

  return { periodStart, periodEnd };
}

/** Cancel an automatic card subscription at period end, never immediately. */
export async function cancelAccessSubscription(
  admin: SupabaseClient<Database>,
  subscriptionCode: string | null | undefined
): Promise<void> {
  if (!subscriptionCode) return;

  const { error } = await admin
    .from("subscriptions")
    .update({ cancel_at_period_end: true, status: "non_renewing", provider: "paystack" })
    .eq("paystack_subscription_code", subscriptionCode)
    .eq("plan", "mad_buddy_access");

  if (error) throw new Error(`Could not cancel Access subscription: ${error.message}`);
}
