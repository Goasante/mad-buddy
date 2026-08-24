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
 * a PRODUCT IDENTIFIER and never a monetary amount; a client that posts
 * `{ amount: 1 }` is ignored because no code path reads an amount from a
 * request. `lib/paystack/sync.ts` additionally rejects any transaction or
 * webhook whose amount differs from configuration, so a tampered checkout fails
 * verification even if it somehow reached the provider.
 *
 * ── THE PRICE, AND WHY IT LIVES IN CODE ───────────────────────────────────
 *
 * GHS 5.00 / month, Paystack plan `PLN_pbpn6h7vprirvlu`. An owner decision,
 * now made.
 *
 * These are DEFAULTS IN SOURCE, not required environment variables, and that is
 * deliberate. An env-only price fails in the worst direction: a missing or
 * fat-fingered variable in one environment silently disables checkout, or
 * disagrees with what Paystack actually charges. The canonical product
 * definition is a fact about the business, so it is versioned, reviewable and
 * identical everywhere by default.
 *
 * The env vars remain as an OVERRIDE for test and staging -- pointing at a
 * Paystack test-mode plan needs no code change -- but production does not
 * depend on them being present.
 *
 * The old tiers were GHS 4.99 (Buddy Plus) and GHS 9.99 (Buddy Pro). Those
 * priced a THREE-TIER FEATURE LADDER that no longer exists and are unrelated
 * to this figure.
 *
 * WHAT THE CLIENT MAY SEND: a product identifier, and nothing else. There is no
 * code path that reads an amount or a plan code from a request.
 */

export type AccessProduct = {
  /** Stable identifier the client may send. Never an amount. */
  id: "mad_buddy_access";
  name: string;
  /**
   * Price in the currency's MINOR unit (pesewas for GHS), or null when no
   * price has been set. Null is the honest representation of "not decided" --
   * a placeholder number would eventually be charged to somebody.
   */
  amountMinor: number | null;
  currency: "GHS";
  /** The provider's plan record. Absent until the product exists there. */
  planCode: string | null;
  interval: "monthly";
};

function parseAmount(raw: string | undefined): number | null {
  if (!raw) return null;
  const value = Number(raw);
  /* A malformed value must not become a price. Rejecting it leaves checkout
     unconfigured, which fails closed; coercing it could charge somebody 0 or
     NaN-adjacent nonsense. */
  if (!Number.isInteger(value) || value <= 0) return null;
  return value;
}

/**
 * GHS 5.00 in the currency's MINOR unit (pesewas). 500, not 5.
 *
 * Paystack charges in minor units, so a value written in cedis here would
 * charge one hundredth of the intended price -- and every amount check would
 * still pass, because both sides would agree on the wrong number.
 */
const ACCESS_AMOUNT_MINOR = 500;

/** The owner's Paystack monthly plan for Mad Buddy Access. */
const ACCESS_PLAN_CODE = "PLN_pbpn6h7vprirvlu";

export const MAD_BUDDY_ACCESS: AccessProduct = {
  id: "mad_buddy_access",
  name: "Mad Buddy Access",
  /* Env overrides exist for test/staging Paystack plans. A malformed override
     falls back to the canonical price rather than disabling checkout: an
     unparseable env var is a configuration mistake, and failing back to the
     known-correct value beats failing closed on a live product. */
  amountMinor: parseAmount(process.env.MAD_BUDDY_ACCESS_AMOUNT_MINOR) ?? ACCESS_AMOUNT_MINOR,
  currency: "GHS",
  planCode: process.env.MAD_BUDDY_ACCESS_PLAN_CODE ?? ACCESS_PLAN_CODE,
  interval: "monthly"
};

/** Display price, derived from the authoritative minor-unit amount. */
export function accessPriceLabel(): string {
  const amount = MAD_BUDDY_ACCESS.amountMinor;
  if (amount === null) return "";
  return `${MAD_BUDDY_ACCESS.currency} ${(amount / 100).toFixed(2)}`;
}

/** True only when a real price AND a provider plan both exist. */
export function isCheckoutConfigured(): boolean {
  return MAD_BUDDY_ACCESS.amountMinor !== null && MAD_BUDDY_ACCESS.planCode !== null;
}

export type CheckoutBlocked = {
  ok: false;
  reason: "not_configured";
  message: string;
};

/**
 * What the UI should say when checkout is not available.
 *
 * Honest about the state rather than pretending a button is broken. It does not
 * blame the user and does not invent a date.
 */
export function checkoutUnavailable(): CheckoutBlocked {
  return {
    ok: false,
    reason: "not_configured",
    message: "Mad Buddy Access isn't available to buy just yet. Nothing has been charged."
  };
}

/**
 * The server-owned amount for a checkout.
 *
 * Takes no amount parameter, deliberately: there is no signature through which
 * a caller could supply one, so the "client sets the price" bug cannot be
 * written against this API.
 */
export function accessCheckoutAmount(): { amountMinor: number; currency: "GHS"; planCode: string } | null {
  if (MAD_BUDDY_ACCESS.amountMinor === null || MAD_BUDDY_ACCESS.planCode === null) return null;
  return {
    amountMinor: MAD_BUDDY_ACCESS.amountMinor,
    currency: MAD_BUDDY_ACCESS.currency,
    planCode: MAD_BUDDY_ACCESS.planCode
  };
}
