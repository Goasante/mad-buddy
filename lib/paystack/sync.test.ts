import { describe, expect, it } from "vitest";
import { validatePaystackSyncInput } from "@/lib/paystack/sync";

const base = {
  userId: "00000000-0000-4000-8000-000000000001",
  plan: "plus" as const,
  // GHS 4.99 in pesewas — must match paystackPlans.plus.amount.
  amount: 499,
  currency: "GHS"
};

describe("Paystack subscription verification", () => {
  it("accepts a server-priced paid plan", () => {
    expect(validatePaystackSyncInput(base)).toBe("buddy_plus");
  });

  it("rejects client or webhook metadata with a spoofed amount", () => {
    expect(() => validatePaystackSyncInput({ ...base, amount: 999 })).toThrow(/amount/i);
  });

  it("rejects unsupported currencies", () => {
    expect(() => validatePaystackSyncInput({ ...base, currency: "USD" })).toThrow(/currency/i);
  });

  it("rejects an unknown supplied plan code even when metadata names a paid plan", () => {
    expect(() => validatePaystackSyncInput({ ...base, planCode: "PLN_untrusted" })).toThrow(/plan/i);
  });
});
