import { beforeEach, describe, expect, it, vi } from "vitest";
import { seed } from "./seed";
import { configSchema, chargeInput, type Order } from "./schema";
import { signToken, readToken, sameOrigin, validPassword } from "./auth";
import { convertedAmount, verified, proofHash, proofMatches } from "./payments";
vi.mock("@/lib/shop/store", () => ({
  configuration: vi.fn(),
  shopStore: vi.fn(),
}));
const order: Order = {
  id: "order-1",
  reference: "GBS-11111111-1111-4111-8111-111111111111",
  email: "buyer@example.com",
  kind: "purchase",
  bookId: "acquisition-v1",
  file: "file:11111111-1111-4111-8111-111111111111",
  amountMinor: 20000,
  currency: "GHS",
  proofHash: "",
  status: "pending",
  createdAt: "2026-10-13",
};
const payment = {
  status: "success",
  reference: order.reference,
  amount: 20000,
  currency: "GHS",
  domain: "live",
  customer: { email: order.email },
  metadata: { product: "godfred_bookshop_v2", order_id: order.id },
};
beforeEach(() => {
  process.env.BOOK_DOWNLOAD_SECRET =
    "test-secret-with-more-than-thirty-two-characters";
  process.env.BOOK_ADMIN_PASSWORD = "synthetic-password-for-unit-tests";
  process.env.PAYSTACK_SECRET_KEY = "sk_live_synthetic";
  process.env.NEXT_PUBLIC_APP_URL = "https://books.example.com";
});
describe("bookshop security boundaries", () => {
  it("rejects using the full edition as the public preview", () => {
    const file = "file:11111111-1111-4111-8111-111111111111";
    expect(configSchema.safeParse({ ...seed, books: [{ ...seed.books[0], pdf: file, preview: file }] }).success).toBe(false);
  });
  it("validates the seed configuration", () =>
    expect(configSchema.safeParse(seed).success).toBe(true));
  it("rejects duplicate book URLs", () =>
    expect(
      configSchema.safeParse({ ...seed, books: [seed.books[0], seed.books[0]] })
        .success
    ).toBe(false));
  it("rejects paths and script URLs for images", () =>
    expect(
      configSchema.safeParse({
        ...seed,
        author: { ...seed.author, portrait: "javascript:alert(1)" },
      }).success
    ).toBe(false));
  it("rejects a visitor-selected GHS charge", () =>
    expect(
      chargeInput.safeParse({
        email: order.email,
        kind: "purchase",
        bookId: order.bookId,
        amount: 1,
      }).success
    ).toBe(false));
  it("converts fractional USD to integer pesewas", () =>
    expect(convertedAmount(5.01, 12)).toBe(6012));
  it("validates a correct payment", () =>
    expect(verified(payment, order)).toBe(true));
  it("uses the same trimmed key mode for provider calls and verification", () => {
    process.env.PAYSTACK_SECRET_KEY = "  sk_live_synthetic  ";
    expect(verified(payment, order)).toBe(true);
  });
  for (const [field, value] of [
    ["status", "pending"],
    ["amount", 1],
    ["currency", "USD"],
    ["domain", "test"],
    ["reference", "another"],
  ] as const)
    it("rejects mismatched " + field, () =>
      expect(verified({ ...payment, [field]: value }, order)).toBe(false)
    );
  it("rejects wrong owner email", () =>
    expect(
      verified({ ...payment, customer: { email: "other@example.com" } }, order)
    ).toBe(false));
  it("rejects mismatched order metadata", () =>
    expect(
      verified(
        {
          ...payment,
          metadata: { product: "godfred_bookshop_v2", order_id: "other" },
        },
        order
      )
    ).toBe(false));
  it("rejects malformed metadata", () =>
    expect(verified({ ...payment, metadata: "{" }, order)).toBe(false));
  it("requires the original browser proof", () => {
    expect(proofMatches("correct", proofHash("correct"))).toBe(true);
    expect(proofMatches("wrong", proofHash("correct"))).toBe(false);
  });
  it("rejects modified, expired and wrong-purpose tokens", () => {
    const token = signToken(
      { exp: Date.now() + 10000, ref: order.reference },
      "purchase"
    );
    expect(readToken(token, "purchase")).not.toBeNull();
    expect(readToken(token + "x", "purchase")).toBeNull();
    expect(readToken(token, "admin")).toBeNull();
    expect(readToken(signToken({ exp: 1 }, "purchase"), "purchase")).toBeNull();
  });
  it("authenticates only the configured password", () => {
    expect(validPassword("synthetic-password-for-unit-tests")).toBe(true);
    expect(validPassword("wrong")).toBe(false);
    delete process.env.BOOK_ADMIN_PASSWORD;
    expect(validPassword("anything")).toBe(false);
  });
  it("rejects a forged request host as CSRF evidence", () => {
    const r = new Request("https://evil.example/api/admin/config", {
      method: "POST",
      headers: { origin: "https://evil.example" },
    });
    expect(sameOrigin(r)).toBe(false);
    expect(
      sameOrigin(
        new Request("https://books.example.com/api/admin/config", {
          method: "POST",
          headers: { origin: "https://books.example.com" },
        })
      )
    ).toBe(true);
  });
});
