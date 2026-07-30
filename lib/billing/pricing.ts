/**
 * Display prices and the plan id alias, in the billing layer.
 *
 * Moved here out of `components/premium/plans.ts` to break an import cycle: the
 * plan cards now derive their limits and capabilities from
 * `lib/billing/upgrade-copy.ts`, which in turn needs the price. A component
 * importing from lib and lib importing back from that component would leave one
 * side `undefined` at module-init time under ESM.
 *
 * This remains the SINGLE source of truth for displayed prices (audit I-12).
 * The public pricing page, the billing page and every upgrade prompt read from
 * here and never hardcode a price string. Charged amounts live in the Paystack
 * plan codes; keep these display values in sync with that configuration.
 */

export type PlanId = "free" | "plus" | "pro";

export const planDisplayPrices: Record<PlanId, string> = {
  free: "GHS 0",
  plus: "GHS 4.99",
  pro: "GHS 9.99"
};

/** The interval those prices are charged over, for copy that states it. */
export const PLAN_BILLING_INTERVAL = "month";
