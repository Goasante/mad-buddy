import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MAD_BUDDY_ACCESS } from "@/lib/access/product";
const read=(p:string)=>readFileSync(join(process.cwd(),p),"utf8");

describe("Mad Buddy Access payment authority",()=>{
  it("keeps the locked source product",()=>{
    expect(MAD_BUDDY_ACCESS.id).toBe("mad_buddy_access");
    expect(MAD_BUDDY_ACCESS.amountMinor).toBe(500);
    expect(MAD_BUDDY_ACCESS.currency).toBe("GHS");
    // Main names the field `planCode` (env-overridable for test/staging
    // Paystack plans, defaulting to the canonical live plan).
    expect(MAD_BUDDY_ACCESS.planCode).toBe("PLN_pbpn6h7vprirvlu");
  });
  it("consumer checkout sends only the stable product id",()=>{
    const button=read("components/premium/checkout-button.tsx");
    expect(button).toContain('/api/access/checkout');
    expect(button).toContain('product: "mad_buddy_access"');
    expect(button).not.toContain('/api/paystack/initialize');
  });
  it("server checkout owns amount currency and provider plan",()=>{
    const route=read("app/api/access/checkout/route.ts");
    // The invariant is that the SERVER owns amount, currency and provider plan
    // -- never the client. Main expresses that with a literal product id in the
    // schema and the price object's own planCode, which is the same authority.
    expect(route).toContain('product: z.literal("mad_buddy_access")');
    expect(route).toContain('accessCheckoutAmount()');
    expect(route).toContain('price.planCode');
  });
  it("retires Plus/Pro initializer fail closed",()=>{
    const legacy=read("app/api/paystack/initialize/route.ts");
    expect(legacy).toContain('status: 410');
    expect(legacy).not.toContain('z.enum(["plus", "pro"])');
  });
});
