import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MAD_BUDDY_ACCESS } from "@/lib/access/product";
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("Mad Buddy Access payment authority", () => {
  it("keeps the locked source product", () => {
    expect(MAD_BUDDY_ACCESS.id).toBe("mad_buddy_access");
    expect(MAD_BUDDY_ACCESS.amountMinor).toBe(499);
    expect(MAD_BUDDY_ACCESS.currency).toBe("GHS");
    expect(MAD_BUDDY_ACCESS.planCode).toBe("PLN_pbpn6h7vprirvlu");
  });

  it("consumer checkout sends only the stable product id and bounded method", () => {
    const button = read("components/premium/checkout-button.tsx");
    expect(button).toContain('/api/access/checkout');
    expect(button).toContain('product: "mad_buddy_access"');
    expect(button).toContain("paymentMethod");
    expect(button).not.toContain("amount:");
    expect(button).not.toContain("currency:");
    expect(button).not.toContain("planCode:");
    expect(button).not.toContain('/api/paystack/initialize');
  });

  it("server checkout owns amount currency duration and provider plan", () => {
    const route = read("app/api/access/checkout/route.ts");
    expect(route).toContain('product: z.literal("mad_buddy_access")');
    expect(route).toContain('z.enum(["card", "mobile_money"])');
    expect(route).toContain('accessCheckoutAmount()');
    expect(route).toContain('accessMobileMoneyCheckoutAmount()');
    expect(route).not.toMatch(/parsed\.data\.(amount|currency|planCode|plan|duration|days)\b/);
  });

  it("uses a recurring plan only for card and no plan for Mobile Money", () => {
    const route = read("app/api/access/checkout/route.ts");
    expect(route).toContain('transactionBody.channels = ["card"]');
    expect(route).toContain('transactionBody.plan = cardPrice?.planCode');
    expect(route).toContain('transactionBody.channels = ["mobile_money"]');
    expect(route).toContain('access_payment_mode: paymentMode');
  });

  it("webhook is the only payment-success authority for Mobile Money", () => {
    const route = read("app/api/access/checkout/route.ts");
    const webhook = read("app/api/paystack/webhook/route.ts");
    expect(route).not.toContain('recordAccessManualPayment(');
    expect(webhook).toContain('eventName !== "charge.success"');
    expect(webhook).toContain('recordAccessManualPayment(admin');
    expect(webhook).toContain('verifyAccessEvent(accessEvent)');
  });

  it("retires Plus/Pro initializer fail closed", () => {
    const legacy = read("app/api/paystack/initialize/route.ts");
    expect(legacy).toContain('status: 410');
    expect(legacy).not.toContain('z.enum(["plus", "pro"])');
  });
});
