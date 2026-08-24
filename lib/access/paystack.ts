import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { MAD_BUDDY_ACCESS } from "@/lib/access/product";
import { deliverNotification } from "@/lib/notifications/server";
import type { Database } from "@/lib/supabase/database.types";

/**
 * PAYSTACK VERIFICATION FOR MAD BUDDY ACCESS.
 *
 * Its own module rather than an extra branch in `lib/paystack/sync.ts`, because
 * the two products verify differently and merging them would corrupt both.
 * The legacy path resolves a Paystack plan code onto a `SubscriptionPlan`
 * (`buddy_plus` / `buddy_pro`) and validates against `paystackPlans`. Access is
 * not a tier: it is one product, one price, one plan code. Forcing it through
 * `appPlanFromPaystack` would mean either inventing a fake tier for it or
 * loosening the legacy checks, and the legacy checks are the only thing
 * standing between a forged webhook and a free subscription.
 *
 * ── WHAT IS VERIFIED, AND WHY EACH MATTERS ────────────────────────────────
 *
 * Everything is compared against SERVER CONFIGURATION. Nothing here trusts a
 * number that arrived in the payload:
 *
 *   plan code   the event must name OUR plan. An event for a different plan --
 *               someone else's, or a plan created by an attacker in their own
 *               Paystack account -- is not our subscription.
 *   amount      must equal the configured minor-unit price exactly. This is
 *               what stops a tampered checkout for GHS 0.01 activating access.
 *   currency    must be GHS. A GHS 5.00 price paid in a weaker currency is a
 *               different (smaller) payment.
 *
 * A single mismatched field rejects the whole event. There is no "close
 * enough": every one of these differing means the event is not the purchase we
 * think it is.
 */

export type AccessPaystackEvent = {
  /** Minor units, as Paystack sends it. */
  amount?: number | null;
  currency?: string | null;
  planCode?: string | null;
  /** `metadata.product` from checkout initialization, when present. */
  product?: string | null;
};

export type AccessVerification =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Does this event belong to the Mad Buddy Access product at all?
 *
 * Deliberately NOT a validation -- it answers routing, not trust. An event for
 * a legacy `buddy_plus` subscription must continue to flow through the old
 * path, so this only claims events that name our plan code or carry our product
 * identifier in metadata.
 */
export function isAccessEvent(event: AccessPaystackEvent): boolean {
  if (MAD_BUDDY_ACCESS.planCode && event.planCode === MAD_BUDDY_ACCESS.planCode) return true;
  return event.product === MAD_BUDDY_ACCESS.id;
}

/**
 * Verify a Paystack event against the server's product configuration.
 *
 * Returns a reason rather than throwing, so a caller can log precisely why an
 * event was refused. Refusal reasons never reach a user -- an attacker probing
 * with malformed events should learn nothing from response differences.
 */
export function verifyAccessEvent(event: AccessPaystackEvent): AccessVerification {
  const expectedAmount = MAD_BUDDY_ACCESS.amountMinor;
  const expectedPlan = MAD_BUDDY_ACCESS.planCode;

  /* Fails closed on an unconfigured product. If the price or plan is somehow
     missing, nothing can be verified, so nothing is accepted -- rather than
     letting an unverifiable event through. */
  if (expectedAmount === null || expectedPlan === null) {
    return { ok: false, reason: "Mad Buddy Access is not configured for payment." };
  }

  /* THE PLAN CODE IS REQUIRED, not optional-if-the-amount-matches.
     An amount alone is forgeable and non-specific: GHS 5.00 is an unremarkable
     sum that could arrive from any transaction. The plan code is what ties a
     payment to THIS recurring product. */
  if (!event.planCode) {
    return { ok: false, reason: "Paystack event carries no plan code." };
  }
  if (event.planCode !== expectedPlan) {
    return { ok: false, reason: "Paystack plan code does not match Mad Buddy Access." };
  }

  /* The amount is checked when present. Some subscription lifecycle events
     (`subscription.disable`) legitimately carry no amount, and demanding one
     would reject valid cancellations. When it IS present it must be exact. */
  if (event.amount != null && event.amount !== expectedAmount) {
    return { ok: false, reason: "Paystack amount does not match the configured price." };
  }

  if (event.currency && event.currency.toUpperCase() !== MAD_BUDDY_ACCESS.currency) {
    return { ok: false, reason: "Paystack currency does not match the configured price." };
  }

  /* Metadata is checked only when present, and only for CONTRADICTION.
     Its absence is normal (Paystack does not echo metadata on every event
     type); a value naming a different product is not. */
  if (event.product && event.product !== MAD_BUDDY_ACCESS.id) {
    return { ok: false, reason: "Paystack metadata names a different product." };
  }

  return { ok: true };
}

/**
 * The subscription window a verified Access payment buys.
 *
 * Prefers Paystack's own `next_payment_date`, because the provider is the
 * authority on when it will next charge. The 30-day fallback exists only for
 * events that omit it, and is deliberately generous by a rounding rather than
 * short: ending access a day early for a paying customer is a worse failure
 * than a day of grace.
 */
export function accessPeriodEnd(nextPaymentDate: string | null | undefined, paidAt: Date): Date {
  if (nextPaymentDate) {
    const parsed = new Date(nextPaymentDate);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  const fallback = new Date(paidAt);
  fallback.setDate(fallback.getDate() + 30);
  return fallback;
}


/**
 * Record a verified Access subscription.
 *
 * WRITES `plan = "mad_buddy_access"`, never a legacy tier. The resolver only
 * asks whether a subscription is live, so a tier label would have "worked" --
 * and quietly attributed this product's revenue to one nobody can buy.
 *
 * The row is upserted on `user_id`, matching the existing subscription
 * lifecycle: one person has one subscription, and a renewal updates it rather
 * than stacking a second.
 */
export async function recordAccessSubscription(
  admin: SupabaseClient<Database>,
  input: {
    userId: string;
    /* `non_renewing` is the existing status for "cancelled, but paid through
       the end of the period" -- exactly what a cancellation means here. */
    status: "active" | "trialing" | "past_due" | "non_renewing";
    periodStart: Date;
    periodEnd: Date;
    customerCode?: string | null;
    subscriptionCode?: string | null;
    emailToken?: string | null;
    authorizationCode?: string | null;
    /** Set when a cancellation should let the paid period run out. */
    cancelAtPeriodEnd?: boolean;
  }
): Promise<void> {
  const { error } = await admin.from("subscriptions").upsert(
    {
      user_id: input.userId,
      provider: "paystack",
      /* The PRODUCT, not a ladder tier. `subscriptions.plan` is typed
         `SubscriptionProduct` precisely so this row can say what actually
         sold. */
      plan: "mad_buddy_access",
      status: input.status,
      paystack_customer_code: input.customerCode ?? null,
      paystack_subscription_code: input.subscriptionCode ?? null,
      paystack_email_token: input.emailToken ?? null,
      paystack_authorization_code: input.authorizationCode ?? null,
      current_period_start: input.periodStart.toISOString(),
      current_period_end: input.periodEnd.toISOString(),
      /* A successful payment ends any grace window: the renewal went through.
         Cancellation sets this separately. */
      grace_ends_at: null,
      cancel_at_period_end: input.cancelAtPeriodEnd ?? false
    },
    { onConflict: "user_id" }
  );

  if (error) throw new Error(`Could not record Access subscription: ${error.message}`);

  await deliverNotification(admin, {
    userId: input.userId,
    priority: "high",
    type: "subscription_update",
    title: "Mad Buddy Access",
    message:
      input.status === "active"
        ? "Your Mad Buddy Access is active. Linkr and UpFor are unlocked."
        : `Your Mad Buddy Access subscription is ${input.status}.`
  });
}

/**
 * Cancel at period end.
 *
 * NEVER REVOKES IMMEDIATELY. Somebody who cancels has paid through the end of
 * their period and keeps what they bought until then -- the resolver already
 * honours `current_period_end`, so simply flagging the row is enough. Ending
 * access the moment somebody cancels would be taking back a paid period, and it
 * is also the behaviour that makes people hesitate to subscribe at all.
 */
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
