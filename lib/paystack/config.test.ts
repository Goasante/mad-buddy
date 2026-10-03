import { afterEach, describe, expect, it, vi } from "vitest";
import { getMissingPaystackWebhookConfig, getPaystackWebhookSecret } from "./config";

vi.mock("server-only", () => ({}));

afterEach(() => vi.unstubAllEnvs());

describe("hosted Paystack payment readiness", () => {
  it("accepts server checkout and signed webhooks without an inline public key", () => {
    vi.stubEnv("PAYSTACK_SECRET_KEY", "synthetic-server-key");
    vi.stubEnv("PAYSTACK_WEBHOOK_SECRET", undefined);
    vi.stubEnv("NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY", undefined);
    expect(getMissingPaystackWebhookConfig()).toEqual([]);
    expect(getPaystackWebhookSecret()).toBe("synthetic-server-key");
  });

  it("falls back to the server key when an optional webhook override is blank", () => {
    vi.stubEnv("PAYSTACK_SECRET_KEY", "synthetic-server-key");
    vi.stubEnv("PAYSTACK_WEBHOOK_SECRET", "  ");
    expect(getMissingPaystackWebhookConfig()).toEqual([]);
    expect(getPaystackWebhookSecret()).toBe("synthetic-server-key");
  });

  it("still refuses a missing API secret even with a webhook override", () => {
    vi.stubEnv("PAYSTACK_SECRET_KEY", undefined);
    vi.stubEnv("PAYSTACK_WEBHOOK_SECRET", "synthetic-webhook-key");
    expect(getMissingPaystackWebhookConfig()).toEqual(["PAYSTACK_SECRET_KEY"]);
  });

  it("still refuses missing or whitespace-only signing credentials", () => {
    vi.stubEnv("PAYSTACK_SECRET_KEY", "  ");
    vi.stubEnv("PAYSTACK_WEBHOOK_SECRET", undefined);
    expect(getMissingPaystackWebhookConfig()).toEqual(["PAYSTACK_SECRET_KEY", "PAYSTACK_WEBHOOK_SECRET"]);
  });
});
