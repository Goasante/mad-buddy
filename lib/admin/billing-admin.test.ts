import { describe, expect, it } from "vitest";
import {
  changeTypeLabel,
  entitlementLabel,
  isOverrideableEntitlement,
  isSubscriptionPlan,
  isSubscriptionStatus,
  maskPaystackReference,
  OVERRIDEABLE_ENTITLEMENTS,
  planLabel,
  planTone,
  statusLabel,
  statusTone,
  SUBSCRIPTION_PLANS,
  SUBSCRIPTION_STATUSES
} from "@/lib/admin/billing-admin";
import { PLAN_ENTITLEMENTS } from "@/lib/billing/entitlements";

describe("plan & status labels", () => {
  it("labels every canonical plan and status", () => {
    for (const plan of SUBSCRIPTION_PLANS) expect(planLabel(plan)).not.toBe(plan);
    for (const status of SUBSCRIPTION_STATUSES) expect(statusLabel(status)).not.toBe("");
  });

  it("tones premium plans and healthy/unhealthy statuses", () => {
    expect(planTone("buddy_pro")).toBe("success");
    expect(planTone("free")).toBe("default");
    expect(statusTone("active")).toBe("success");
    expect(statusTone("past_due")).toBe("warning");
    expect(statusTone("cancelled")).toBe("danger");
  });

  it("validates plan/status membership", () => {
    expect(isSubscriptionPlan("buddy_plus")).toBe(true);
    expect(isSubscriptionPlan("gold")).toBe(false);
    expect(isSubscriptionStatus("attention")).toBe(true);
    expect(isSubscriptionStatus("paused")).toBe(false);
  });
});

describe("overrideable entitlements", () => {
  it("only lists real boolean entitlement keys", () => {
    const freeEntitlements = PLAN_ENTITLEMENTS.free as Record<string, unknown>;
    for (const { key } of OVERRIDEABLE_ENTITLEMENTS) {
      expect(key in freeEntitlements).toBe(true);
      expect(typeof freeEntitlements[key]).toBe("boolean");
    }
  });

  it("recognises overrideable keys and rejects unknown or numeric ones", () => {
    expect(isOverrideableEntitlement("priority_support")).toBe(true);
    expect(isOverrideableEntitlement("max_muddies")).toBe(false); // numeric, not offered
    expect(isOverrideableEntitlement("___nope___")).toBe(false);
  });

  it("labels a known entitlement and change type", () => {
    expect(entitlementLabel("priority_support")).toBe("Priority support");
    expect(changeTypeLabel("cancel")).toBe("Cancellation");
  });
});

describe("privacy-safe Paystack reference masking", () => {
  it("masks all but the last four characters", () => {
    expect(maskPaystackReference("SUB_abcd1234")).toBe("•••• 1234");
  });

  it("never leaks the full reference", () => {
    const code = "AUTH_supersecretvalue";
    expect(maskPaystackReference(code)).not.toContain("supersecret");
  });

  it("reports missing references cleanly", () => {
    expect(maskPaystackReference(null)).toBe("Not linked");
    expect(maskPaystackReference(undefined)).toBe("Not linked");
  });
});
