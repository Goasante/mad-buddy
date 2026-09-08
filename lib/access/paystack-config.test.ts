import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  ACCESS_MANUAL_PERIOD_DAYS,
  MAD_BUDDY_ACCESS,
  accessCheckoutAmount,
  accessMobileMoneyCheckoutAmount,
  accessPriceLabel,
  isCheckoutConfigured,
  isMobileMoneyCheckoutConfigured
} from "@/lib/access/product";
import {
  accessPeriodEnd,
  isAccessEvent,
  isManualMobileMoneyAccessEvent,
  manualAccessPeriodEnd,
  verifyAccessEvent
} from "@/lib/access/paystack";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const PLAN = "PLN_pbpn6h7vprirvlu";

describe("the configured product", () => {
  it("is GHS 4.99 in minor units", () => {
    expect(MAD_BUDDY_ACCESS.amountMinor).toBe(499);
    expect(MAD_BUDDY_ACCESS.currency).toBe("GHS");
    expect(accessPriceLabel()).toBe("GHS 4.99");
  });

  it("keeps the recurring card plan and a 30-day manual period", () => {
    expect(MAD_BUDDY_ACCESS.planCode).toBe(PLAN);
    expect(MAD_BUDDY_ACCESS.interval).toBe("monthly");
    expect(ACCESS_MANUAL_PERIOD_DAYS).toBe(30);
  });

  it("configures card and Mobile Money independently", () => {
    expect(isCheckoutConfigured()).toBe(true);
    expect(isMobileMoneyCheckoutConfigured()).toBe(true);
    expect(accessCheckoutAmount()).toEqual({ amountMinor: 499, currency: "GHS", planCode: PLAN });
    expect(accessMobileMoneyCheckoutAmount()).toEqual({ amountMinor: 499, currency: "GHS" });
  });

  it("exposes no way for a caller to supply an amount", () => {
    expect(accessCheckoutAmount.length).toBe(0);
    expect(accessMobileMoneyCheckoutAmount.length).toBe(0);
  });
});

describe("event routing", () => {
  it("claims recurring events naming our plan code", () => {
    expect(isAccessEvent({ planCode: PLAN })).toBe(true);
  });

  it("claims one-time events carrying our product metadata", () => {
    expect(isAccessEvent({ product: "mad_buddy_access" })).toBe(true);
  });

  it("identifies the manual Mobile Money mode exactly", () => {
    expect(isManualMobileMoneyAccessEvent({ paymentMode: "mobile_money_30d" })).toBe(true);
    expect(isManualMobileMoneyAccessEvent({ paymentMode: "card_subscription" })).toBe(false);
  });

  it("leaves legacy tier events to the legacy path", () => {
    expect(isAccessEvent({ planCode: "PLN_legacy_plus" })).toBe(false);
    expect(isAccessEvent({})).toBe(false);
  });
});

describe("recurring card webhook verification", () => {
  const valid = {
    planCode: PLAN,
    amount: 499,
    currency: "GHS",
    product: "mad_buddy_access",
    paymentMode: "card_subscription"
  };

  it("accepts a correct recurring event", () => {
    expect(verifyAccessEvent(valid)).toEqual({ ok: true });
  });

  it("rejects a cheaper or larger amount", () => {
    expect(verifyAccessEvent({ ...valid, amount: 1 }).ok).toBe(false);
    expect(verifyAccessEvent({ ...valid, amount: 50_000 }).ok).toBe(false);
  });

  it("requires the recurring plan code", () => {
    expect(verifyAccessEvent({ amount: 499, currency: "GHS" }).ok).toBe(false);
    expect(verifyAccessEvent({ ...valid, planCode: "PLN_someone_elses" }).ok).toBe(false);
  });

  it("rejects a different currency or contradictory product", () => {
    expect(verifyAccessEvent({ ...valid, currency: "NGN" }).ok).toBe(false);
    expect(verifyAccessEvent({ ...valid, product: "something_else" }).ok).toBe(false);
  });

  it("still accepts lifecycle events that carry the plan but omit amount", () => {
    expect(verifyAccessEvent({ planCode: PLAN }).ok).toBe(true);
  });
});

describe("Ghana Mobile Money webhook verification", () => {
  const valid = {
    product: "mad_buddy_access",
    paymentMode: "mobile_money_30d",
    planCode: null,
    amount: 499,
    currency: "GHS",
    channel: "mobile_money"
  };

  it("accepts the exact one-time Mobile Money payment shape", () => {
    expect(verifyAccessEvent(valid)).toEqual({ ok: true });
  });

  it("rejects a cheaper amount", () => {
    expect(verifyAccessEvent({ ...valid, amount: 1 }).ok).toBe(false);
  });

  it("requires GHS and the Mobile Money channel", () => {
    expect(verifyAccessEvent({ ...valid, currency: "NGN" }).ok).toBe(false);
    expect(verifyAccessEvent({ ...valid, channel: "card" }).ok).toBe(false);
    expect(verifyAccessEvent({ ...valid, channel: null }).ok).toBe(false);
  });

  it("requires our product metadata and exact payment mode", () => {
    expect(verifyAccessEvent({ ...valid, product: null }).ok).toBe(false);
    expect(verifyAccessEvent({ ...valid, product: "something_else" }).ok).toBe(false);
    expect(verifyAccessEvent({ ...valid, paymentMode: "unknown" }).ok).toBe(false);
  });

  it("rejects any recurring plan attached to the Mobile Money payment", () => {
    expect(verifyAccessEvent({ ...valid, planCode: PLAN }).ok).toBe(false);
  });
});

describe("the paid period", () => {
  it("prefers Paystack's next payment date for a card subscription", () => {
    const paidAt = new Date("2026-01-01T00:00:00Z");
    const end = accessPeriodEnd("2026-02-05T00:00:00Z", paidAt);
    expect(end.toISOString()).toBe("2026-02-05T00:00:00.000Z");
  });

  it("falls back to 30 days", () => {
    const paidAt = new Date("2026-01-01T00:00:00Z");
    expect(accessPeriodEnd(null, paidAt).toISOString()).toBe("2026-01-31T00:00:00.000Z");
  });

  it("does not extend a manual period again when the same webhook is retried", () => {
    const paidAt = new Date("2026-01-01T00:00:00Z");
    const firstEnd = manualAccessPeriodEnd(paidAt);
    const retryEnd = manualAccessPeriodEnd(paidAt, firstEnd.toISOString());
    expect(firstEnd.toISOString()).toBe("2026-01-31T00:00:00.000Z");
    expect(retryEnd.toISOString()).toBe(firstEnd.toISOString());
  });

  it("never shortens an already-later manual period on a retry", () => {
    const paidAt = new Date("2026-01-01T00:00:00Z");
    expect(manualAccessPeriodEnd(paidAt, "2026-02-10T00:00:00.000Z").toISOString()).toBe(
      "2026-02-10T00:00:00.000Z"
    );
  });
});

describe("a non-renewing paid period remains valid", () => {
  it("the resolver counts non_renewing as live access", () => {
    const resolver = code(read("lib/access/resolver.ts"));
    expect(resolver).toContain('"non_renewing"');
    expect(resolver).toMatch(/\.in\("status",\s*\[[^\]]*"non_renewing"/);
  });

  it("manual Mobile Money writes non_renewing and clears recurring credentials", () => {
    const paystack = code(read("lib/access/paystack.ts"));
    expect(paystack).toContain('status: "non_renewing"');
    expect(paystack).toContain("subscriptionCode: null");
    expect(paystack).toContain("cancelAtPeriodEnd: true");
  });
});

describe("checkout accepts no money from the client", () => {
  const route = code(read("app/api/access/checkout/route.ts"));

  it("accepts only the product and bounded payment method", () => {
    expect(route).toContain('product: z.literal("mad_buddy_access")');
    expect(route).toContain('z.enum(["card", "mobile_money"])');
  });

  it("never reads amount currency plan or duration from request data", () => {
    expect(route).not.toMatch(/parsed\.data\.(amount|currency|planCode|plan|duration|days)\b/);
  });

  it("takes both charge shapes from server configuration", () => {
    expect(route).toContain("accessCheckoutAmount()");
    expect(route).toContain("accessMobileMoneyCheckoutAmount()");
    expect(route).toContain('transactionBody.channels = ["card"]');
    expect(route).toContain('transactionBody.channels = ["mobile_money"]');
  });

  it("attaches a recurring plan only to card", () => {
    expect(route).toContain('if (paymentMethod === "card")');
    expect(route).toContain("transactionBody.plan = cardPrice?.planCode");
  });

  it("verifies the provider card plan matches the server-owned price before checkout", () => {
    expect(route).toContain("/plan/${encodeURIComponent(cardPrice.planCode)}");
    expect(route).toContain("providerPlan.amount === cardPrice.amountMinor");
    expect(route).toContain("providerPlan.currency?.toUpperCase() === cardPrice.currency");
  });

  it("does not mark a new customer paid before payment", () => {
    expect(route).toContain('plan: "free"');
    expect(route).toContain('status: "free"');
  });
});
