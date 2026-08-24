import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { MAD_BUDDY_ACCESS, accessCheckoutAmount, isCheckoutConfigured } from "@/lib/access/product";

/**
 * THE PAYMENT BOUNDARY.
 *
 * Provider events flow one way:
 *
 *   provider event -> verified server processing -> canonical subscription row
 *                  -> entitlement resolver -> access
 *
 * The provider is never consulted at request time, and never decides
 * entitlement. A forged callback cannot reach the resolver, and a Paystack
 * outage cannot revoke a paying customer mid-request.
 */

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const webhook = read("app/api/paystack/webhook/route.ts");
const initialize = read("app/api/paystack/initialize/route.ts");
const resolver = read("lib/access/resolver.ts");
const product = read("lib/access/product.ts");

describe("price authority is the server", () => {
  it("the product exposes no way for a caller to supply an amount", () => {
    /* `accessCheckoutAmount()` takes no parameters. The "client sets the price"
       bug cannot be written against an API with no amount in its signature. */
    expect(accessCheckoutAmount.length).toBe(0);
    expect(code(product)).not.toMatch(/function accessCheckoutAmount\([^)]+\)/);
  });

  it("checkout initialization never reads an amount from the request body", () => {
    /* The existing route derives the amount from `plan.amount` server-side.
       A client posting {amount: 1} is ignored because nothing reads it. */
    const body = code(initialize);
    expect(body, "the checkout route reads an amount from the client")
      .not.toMatch(/(body|payload|json|input|parsed(\.data)?)\s*\.\s*amount/);
    expect(body).toContain("plan.amount");
  });

  it("an unset price leaves checkout unconfigured rather than free or zero", () => {
    /* FAILS CLOSED. A malformed or missing MAD_BUDDY_ACCESS_AMOUNT_MINOR must
       not become a price -- coercing it could charge 0. Null means "not
       decided", and checkout refuses. */
    if (MAD_BUDDY_ACCESS.amountMinor === null) {
      expect(isCheckoutConfigured()).toBe(false);
      expect(accessCheckoutAmount()).toBeNull();
    } else {
      expect(MAD_BUDDY_ACCESS.amountMinor).toBeGreaterThan(0);
      expect(Number.isInteger(MAD_BUDDY_ACCESS.amountMinor)).toBe(true);
    }
  });

  it("does not inherit an old tier price by accident", () => {
    /* GHS 4.99 and 9.99 priced a three-tier ladder that no longer exists.
       Silently reusing one would be choosing a consumer price by accident. */
    if (MAD_BUDDY_ACCESS.amountMinor !== null) {
      expect([499, 999], "the Access price is an old tier price — confirm this is deliberate")
        .not.toContain(MAD_BUDDY_ACCESS.amountMinor);
    }
  });
});

describe("webhook security", () => {
  it("verifies an HMAC signature with a timing-safe comparison", () => {
    const body = code(webhook);
    expect(body).toContain("createHmac");
    expect(body).toContain("sha512");
    expect(body, "signature comparison is not timing-safe").toContain("timingSafeEqual");
    /* timingSafeEqual THROWS on unequal lengths, so a length check must come
       first or a malformed signature becomes a 500 instead of a 401. */
    expect(body).toMatch(/length === .*length|length !== .*length/);
  });

  it("is idempotent on the provider event id", () => {
    // A retried or duplicated delivery must not double-apply.
    expect(code(webhook)).toContain("provider_event_id");
    expect(code(webhook)).toContain("dedupe_key");
  });

  it("verifies the amount rather than trusting the payload", () => {
    const sync = code(read("lib/paystack/sync.ts"));
    expect(sync).toMatch(/amount/);
    expect(sync, "the sync layer does not compare amounts").toMatch(/expected|mismatch|!==/);
  });
});

describe("the provider is not the authority", () => {
  it("the resolver reads the local subscription row, never the provider API", () => {
    /* Calling Paystack at resolve time would make every gated action depend on
       a third party being up, and would let a provider outage revoke a paying
       customer. The webhook writes the canonical row; the resolver reads it. */
    const body = code(resolver);
    expect(body).toContain('from("subscriptions")');
    expect(body, "the resolver calls the payment provider at request time")
      .not.toMatch(/paystack|api\.paystack|fetch\(/i);
  });

  it("the resolver accepts any provider through one mapping", () => {
    /* Apple and Google slot in by provider string, not a second code path.
       This is what stops native requiring a monetization rewrite. */
    const body = code(resolver);
    expect(body).toContain("apple_subscription");
    expect(body).toContain("google_subscription");
    expect(body).toContain("web_subscription");
  });

  it("does not pretend Apple or Google are implemented", () => {
    /* They exist as source types with no integration behind them. A fake
       verification path would be worse than none. */
    for (const path of ["lib/access/resolver.ts", "lib/access/guard.ts", "lib/access/admin.ts"]) {
      const body = code(read(path));
      expect(body, `${path} pretends to verify an App Store receipt`)
        .not.toMatch(/verifyReceipt|androidpublisher|appstoreconnect/i);
    }
  });

  it("past_due keeps access only inside its grace window", () => {
    /* A failed renewal should not lock somebody out while a card is retried,
       and must not grant access forever either. */
    const body = code(resolver);
    expect(body).toContain("past_due");
    expect(body).toContain("grace_ends_at");
  });
});

describe("entitlement is never cached past a mutation", () => {
  it("the guard resolves against the database on every check", () => {
    /* A cached entitlement is the classic way an expired or revoked user keeps
       mutating: the cache outlives the revocation. The read is a few indexed
       lookups and runs only on paid-surface mutations, so being correct by
       construction costs little and leaves no staleness window to reason about. */
    const guard = code(read("lib/access/guard.ts"));
    expect(guard).toContain("resolveAccessForUser");
    expect(guard, "the guard caches entitlement").not.toMatch(/unstable_cache|revalidate:\s*\d+|cache\(/);
  });

  it("the resolver itself is uncached", () => {
    expect(code(resolver), "the resolver caches its own result")
      .not.toMatch(/unstable_cache|revalidate:\s*\d+/);
  });
});
