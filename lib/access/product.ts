import "server-only";

/**
 * THE MAD BUDDY ACCESS PRODUCT.
 *
 * One consumer product, not a tier ladder. It unlocks exactly two surfaces --
 * Linkr and UpFor -- and nothing else in the app is affected by owning it.
 *
 * ── PRICE AUTHORITY IS THE SERVER, ALWAYS ─────────────────────────────────
 *
 * The amount lives here and in the provider's own plan record. A client sends
 * a PRODUCT IDENTIFIER and a bounded checkout method, never a monetary amount;
 * a client that posts `{ amount: 1 }` has no code path through which that value
 * can become a charge. `lib/access/paystack.ts` additionally verifies every
 * successful payment against this configuration before Access is granted.
 *
 * The consumer price is deliberately source-locked at GHS 4.99 (499 pesewas).
 * It is not environment-overridable, preventing stale deployment configuration
 * from silently charging a different amount than the product advertises.
 *
 * ── TWO PAYMENT EXPERIENCES, ONE PRODUCT ──────────────────────────────────
 *
 * Card uses Paystack's monthly plan and auto-renews until cancelled.
 * Ghana Mobile Money is a one-time GHS 4.99 payment that buys 30 days of the
 * exact same Access. It does NOT pretend to be a recurring Paystack plan:
 * Paystack Mobile Money does not support recurring subscription billing.
 *
 * Both paths therefore share the product/price authority here while differing
 * only in renewal semantics. The entitlement itself remains provider-neutral.
 */

export type AccessCheckoutMethod = "card" | "mobile_money";
export type AccessPaymentMode = "card_subscription" | "mobile_money_30d";

export const ACCESS_MANUAL_PERIOD_DAYS = 30;

export type AccessProduct = {
  /** Stable identifier the client may send. Never an amount. */
  id: "mad_buddy_access";
  name: string;
  /** Price in the currency's MINOR unit (pesewas for GHS). */
  amountMinor: number;
  currency: "GHS";
  /** Paystack's recurring card-plan record. Mobile Money intentionally omits it. */
  planCode: string | null;
  interval: "monthly";
};

/** GHS 4.99 in the currency's MINOR unit (pesewas). 499, not 4.99. */
const ACCESS_AMOUNT_MINOR = 499;

/** The owner's Paystack monthly plan for recurring card Access. */
const ACCESS_PLAN_CODE = "PLN_pbpn6h7vprirvlu";

export const MAD_BUDDY_ACCESS: AccessProduct = {
  id: "mad_buddy_access",
  name: "Mad Buddy Access",
  amountMinor: ACCESS_AMOUNT_MINOR,
  currency: "GHS",
  planCode: process.env.MAD_BUDDY_ACCESS_PLAN_CODE ?? ACCESS_PLAN_CODE,
  interval: "monthly"
};

/** Display price, derived from the authoritative minor-unit amount. */
export function accessPriceLabel(): string {
  return `${MAD_BUDDY_ACCESS.currency} ${(MAD_BUDDY_ACCESS.amountMinor / 100).toFixed(2)}`;
}

/** Recurring-card checkout requires both the source-locked price and Paystack plan. */
export function isCheckoutConfigured(): boolean {
  return MAD_BUDDY_ACCESS.planCode !== null;
}

/** Mobile Money is one-time and uses the source-locked price. */
export function isMobileMoneyCheckoutConfigured(): boolean {
  return true;
}

export type CheckoutBlocked = {
  ok: false;
  reason: "not_configured";
  message: string;
};

export function checkoutUnavailable(): CheckoutBlocked {
  return {
    ok: false,
    reason: "not_configured",
    message: "Mad Buddy Access isn't available to buy just yet. Nothing has been charged."
  };
}

/**
 * The server-owned recurring-card checkout values.
 *
 * Takes no amount parameter deliberately. `planCode` is required because this
 * path creates the provider subscription that auto-renews.
 */
export function accessCheckoutAmount(): { amountMinor: number; currency: "GHS"; planCode: string } | null {
  if (MAD_BUDDY_ACCESS.planCode === null) return null;
  return {
    amountMinor: MAD_BUDDY_ACCESS.amountMinor,
    currency: MAD_BUDDY_ACCESS.currency,
    planCode: MAD_BUDDY_ACCESS.planCode
  };
}

/**
 * The server-owned one-time Mobile Money charge.
 *
 * There is intentionally no `planCode`: attaching the recurring plan is what
 * makes Paystack hide Mobile Money for this product.
 */
export function accessMobileMoneyCheckoutAmount(): { amountMinor: number; currency: "GHS" } {
  return {
    amountMinor: MAD_BUDDY_ACCESS.amountMinor,
    currency: MAD_BUDDY_ACCESS.currency
  };
}
