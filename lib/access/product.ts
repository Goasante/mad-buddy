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
 * ── THE PRICE IS NOT SET, AND IS NOT INVENTED HERE ────────────────────────
 *
 * The old tiers were GHS 4.99 (Buddy Plus) and GHS 9.99 (Buddy Pro). Those are
 * prices for a THREE-TIER FEATURE LADDER that no longer exists; reusing one for
 * a single two-feature product would be picking a consumer price by accident.
 * That is an owner decision with revenue consequences, so:
 *
 *   `MAD_BUDDY_ACCESS.amountMinor` is null until configured
 *   `isCheckoutConfigured()` returns false while it is
 *   `beginAccessCheckout()` refuses rather than guessing
 *
 * EVERYTHING ELSE IN THE ENTITLEMENT SYSTEM WORKS WITHOUT IT. Welcome Access,
 * admin grants, global windows, the resolver, both gates and the whole UX are
 * live and testable. Only the act of taking money is blocked, which is the
 * narrowest possible thing to block on a missing price.
 *
 * Setting `MAD_BUDDY_ACCESS_AMOUNT_MINOR` and `MAD_BUDDY_ACCESS_PLAN_CODE`
 * turns checkout on with no code change.
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

export const MAD_BUDDY_ACCESS: AccessProduct = {
  id: "mad_buddy_access",
  name: "Mad Buddy Access",
  amountMinor: parseAmount(process.env.MAD_BUDDY_ACCESS_AMOUNT_MINOR),
  currency: "GHS",
  planCode: process.env.MAD_BUDDY_ACCESS_PLAN_CODE ?? null,
  interval: "monthly"
};

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
