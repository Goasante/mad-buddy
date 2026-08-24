import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { MAD_BUDDY_ACCESS, accessCheckoutAmount, accessPriceLabel, isCheckoutConfigured } from "@/lib/access/product";
import { accessPeriodEnd, isAccessEvent, verifyAccessEvent } from "@/lib/access/paystack";

/**
 * THE OWNER'S PAYSTACK CONFIGURATION, AND THE VERIFICATION AROUND IT.
 *
 * Mad Buddy Access is GHS 5.00/month on plan `PLN_pbpn6h7vprirvlu`. These
 * assertions exist because every one of them is a way to lose money quietly:
 * a price in the wrong unit charges 1% of the intended amount, a missing plan
 * check accepts any GHS 5.00 payment as a subscription, and a status omitted
 * from the resolver revokes access somebody already paid for.
 */

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const PLAN = "PLN_pbpn6h7vprirvlu";

describe("the configured product", () => {
  it("is GHS 5.00, expressed in MINOR units", () => {
    /* 500 pesewas, not 5 cedis. Paystack charges in minor units, so a value in
       cedis would charge one hundredth of the price -- and every amount check
       would still pass, because both sides would agree on the wrong number. */
    expect(MAD_BUDDY_ACCESS.amountMinor).toBe(500);
    expect(MAD_BUDDY_ACCESS.currency).toBe("GHS");
    expect(accessPriceLabel()).toBe("GHS 5.00");
  });

  it("names the owner's Paystack plan", () => {
    expect(MAD_BUDDY_ACCESS.planCode).toBe(PLAN);
    expect(MAD_BUDDY_ACCESS.interval).toBe("monthly");
  });

  it("is checkout-ready without any environment variable", () => {
    /* The canonical price lives in source, so a missing env var cannot silently
       disable checkout in one environment. */
    expect(isCheckoutConfigured()).toBe(true);
    expect(accessCheckoutAmount()).toEqual({ amountMinor: 500, currency: "GHS", planCode: PLAN });
  });

  it("exposes no way for a caller to supply an amount", () => {
    // No parameters means the "client sets the price" bug cannot be written.
    expect(accessCheckoutAmount.length).toBe(0);
  });
});

describe("event routing", () => {
  it("claims events naming our plan code", () => {
    expect(isAccessEvent({ planCode: PLAN })).toBe(true);
  });

  it("claims events carrying our product metadata", () => {
    expect(isAccessEvent({ product: "mad_buddy_access" })).toBe(true);
  });

  it("leaves legacy tier events to the legacy path", () => {
    /* A buddy_plus subscription must keep flowing through the old sync, which
       validates against the retired ladder. Claiming it here would put it
       through rules that do not apply to it. */
    expect(isAccessEvent({ planCode: "PLN_legacy_plus" })).toBe(false);
    expect(isAccessEvent({})).toBe(false);
  });
});

describe("webhook verification", () => {
  const valid = { planCode: PLAN, amount: 500, currency: "GHS", product: "mad_buddy_access" };

  it("accepts a correct event", () => {
    expect(verifyAccessEvent(valid)).toEqual({ ok: true });
  });

  it("REJECTS a cheaper amount", () => {
    // The single most valuable assertion here: GHS 0.01 must not buy access.
    expect(verifyAccessEvent({ ...valid, amount: 1 }).ok).toBe(false);
  });

  it("rejects a larger amount too", () => {
    /* Not paranoia -- an amount that does not match configuration means the
       event is not the purchase we think it is, whichever direction it differs. */
    expect(verifyAccessEvent({ ...valid, amount: 50_000 }).ok).toBe(false);
  });

  it("rejects a different plan code", () => {
    expect(verifyAccessEvent({ ...valid, planCode: "PLN_someone_elses" }).ok).toBe(false);
  });

  it("REQUIRES a plan code, even when the amount is right", () => {
    /* An amount alone is non-specific: GHS 5.00 is an unremarkable sum that
       could arrive from any transaction. The plan code is what ties a payment
       to this recurring product. */
    expect(verifyAccessEvent({ amount: 500, currency: "GHS" }).ok).toBe(false);
  });

  it("rejects a different currency", () => {
    expect(verifyAccessEvent({ ...valid, currency: "NGN" }).ok).toBe(false);
  });

  it("accepts a lowercase currency", () => {
    // Providers are inconsistent about case; the value is what matters.
    expect(verifyAccessEvent({ ...valid, currency: "ghs" }).ok).toBe(true);
  });

  it("rejects metadata naming a different product", () => {
    expect(verifyAccessEvent({ ...valid, product: "something_else" }).ok).toBe(false);
  });

  it("tolerates a missing amount, for lifecycle events", () => {
    /* `subscription.disable` and friends legitimately carry no amount.
       Demanding one would reject valid cancellations. */
    expect(verifyAccessEvent({ planCode: PLAN }).ok).toBe(true);
  });
});

describe("the paid period", () => {
  it("prefers Paystack's own next payment date", () => {
    const paidAt = new Date("2026-01-01T00:00:00Z");
    const end = accessPeriodEnd("2026-02-05T00:00:00Z", paidAt);
    expect(end.toISOString()).toBe("2026-02-05T00:00:00.000Z");
  });

  it("falls back to 30 days when the provider omits it", () => {
    const paidAt = new Date("2026-01-01T00:00:00Z");
    expect(accessPeriodEnd(null, paidAt).toISOString()).toBe("2026-01-31T00:00:00.000Z");
  });

  it("falls back rather than producing an Invalid Date", () => {
    /* A malformed date must not become `new Date(NaN)`, which would serialise
       to null and leave a subscription with no period end at all. */
    const paidAt = new Date("2026-01-01T00:00:00Z");
    expect(Number.isNaN(accessPeriodEnd("not-a-date", paidAt).getTime())).toBe(false);
  });
});

describe("a cancelled subscription keeps its paid period", () => {
  it("the resolver counts non_renewing as live access", () => {
    /* THE REGRESSION THIS EXISTS FOR.
     *
     * `non_renewing` means "cancelled, but paid through the end of the period".
     * Omitting it from the resolver's status filter revoked access the instant
     * somebody cancelled -- taking back time they had already paid for, and
     * punishing them for cancelling early rather than at the last minute.
     * Caught by scripts/hardening/access-payment-matrix.mjs. */
    const resolver = code(read("lib/access/resolver.ts"));
    expect(resolver).toContain('"non_renewing"');
    expect(resolver).toMatch(/\.in\("status",\s*\[[^\]]*"non_renewing"/);
  });

  it("cancellation flags the row rather than revoking it", () => {
    const paystack = code(read("lib/access/paystack.ts"));
    expect(paystack).toContain("cancel_at_period_end: true");
    expect(paystack, "cancellation deletes the subscription").not.toContain(".delete()");
  });
});

describe("checkout accepts no money from the client", () => {
  const route = code(read("app/api/access/checkout/route.ts"));

  it("its schema has exactly one field, the product literal", () => {
    expect(route).toContain('product: z.literal("mad_buddy_access")');
  });

  it("never reads an amount, currency or plan code from the request", () => {
    expect(route).not.toMatch(/parsed\.data\.(amount|currency|planCode|plan)\b/);
  });

  it("takes every chargeable value from server configuration", () => {
    expect(route).toContain("accessCheckoutAmount()");
    expect(route).toContain("price.amountMinor");
    expect(route).toContain("price.planCode");
  });

  it("fails closed when the product is not configured", () => {
    expect(route).toContain("isCheckoutConfigured()");
  });

  it("does not mark a subscription paid before payment", () => {
    /* The placeholder customer row is free/free. Writing the product here would
       make an abandoned checkout look like a sale, and the resolver reads this
       table. */
    expect(route).toContain('plan: "free"');
  });
});
