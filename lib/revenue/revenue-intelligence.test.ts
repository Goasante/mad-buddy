import { describe, expect, it } from "vitest";
import { buildRevenueReport, type RevenueCurrentCounts, type RevenueEvent, type RevenueFact } from "@/lib/revenue/revenue-intelligence";

const current: RevenueCurrentCounts = {
  totalUsers: 100,
  activePayingUsers: 30,
  freeUsers: 70,
  buddyPlusUsers: 20,
  buddyProUsers: 10,
  graceUsers: 2,
  expiredGraceUsers: 1,
  planUsers: { free: 70, buddy_plus: 20, buddy_pro: 10 }
};

function event(eventType: string, userId: string, extra: Partial<RevenueEvent> = {}): RevenueEvent {
  return {
    eventType,
    userId,
    plan: "buddy_plus",
    previousPlan: "free",
    amountMinor: null,
    currency: null,
    occurredAt: "2026-07-25T10:00:00.000Z",
    ...extra
  };
}

function fact(userId: string, featureKey: string, plan: "free" | "buddy_plus" | "buddy_pro", eventName = "plan_created"): RevenueFact {
  return { userId, featureKey, subscriptionPlan: plan, eventName, eventDate: "2026-07-24", actionCount: 2 };
}

describe("revenue intelligence", () => {
  it("calculates MRR, ARR and collected revenue separately by currency", () => {
    const report = buildRevenueReport({
      currentCounts: current,
      events: [
        event("payment_succeeded", "plus", { amountMinor: 499, currency: "GHS" }),
        event("payment_succeeded", "pro", { plan: "buddy_pro", amountMinor: 1200, currency: "USD" })
      ],
      facts: [],
      planPrices: [
        { plan: "buddy_plus", amountMinor: 499, currency: "GHS" },
        { plan: "buddy_pro", amountMinor: 1200, currency: "USD" }
      ],
      now: new Date("2026-07-26T12:00:00.000Z"),
      rangeDays: 30
    });
    expect(report.currencies).toEqual(expect.arrayContaining([
      expect.objectContaining({ currency: "GHS", mrrMinor: 9980, arrRunRateMinor: 119760, collectedMinor: 499 }),
      expect.objectContaining({ currency: "USD", mrrMinor: 12000, arrRunRateMinor: 144000, collectedMinor: 1200 })
    ]));
  });

  it("reports funnel conversion without fabricating missing stages", () => {
    const report = buildRevenueReport({
      currentCounts: current,
      events: [
        event("pricing_viewed", "a"), event("pricing_viewed", "b"),
        event("checkout_started", "a"), event("payment_attempted", "a"),
        event("payment_succeeded", "a", { amountMinor: 499, currency: "GHS" }),
        event("subscription_activated", "a", { amountMinor: null, currency: "GHS" })
      ],
      facts: [],
      planPrices: [{ plan: "buddy_plus", amountMinor: 499, currency: "GHS" }],
      now: new Date("2026-07-26T12:00:00.000Z"),
      rangeDays: 30
    });
    expect(report.funnel.find((step) => step.key === "pricing_viewed")).toMatchObject({ users: 2 });
    expect(report.funnel.find((step) => step.key === "checkout_started")).toMatchObject({ users: 1, conversionPercent: 50, dropOffPercent: 50 });
    expect(report.funnel.find((step) => step.key === "subscription_renewed")).toMatchObject({ users: 0, conversionPercent: 0 });
  });

  it("excludes events and product facts outside the selected reporting period", () => {
    const report = buildRevenueReport({
      currentCounts: current,
      events: [
        event("payment_succeeded", "recent", { amountMinor: 499, currency: "GHS" }),
        event("payment_succeeded", "old", {
          amountMinor: 999,
          currency: "GHS",
          occurredAt: "2026-06-01T10:00:00.000Z"
        })
      ],
      facts: [
        fact("recent", "plans", "buddy_plus"),
        { ...fact("old", "plans", "buddy_plus"), eventDate: "2026-06-01" }
      ],
      planPrices: [{ plan: "buddy_plus", amountMinor: 499, currency: "GHS" }],
      now: new Date("2026-07-26T12:00:00.000Z"),
      rangeDays: 30
    });

    expect(report.currencies.find((row) => row.currency === "GHS")?.collectedMinor).toBe(499);
    expect(report.featurePlans.find((row) => row.featureKey === "plans")).toMatchObject({ plusUsers: 1 });
  });

  it("calculates payment recovery, churn, feature segments and invite attribution", () => {
    const report = buildRevenueReport({
      currentCounts: current,
      events: [
        event("payment_failed", "a"), event("payment_failed", "b"), event("payment_recovered", "a"),
        event("subscription_cancelled", "c"), event("plan_upgraded", "d"), event("plan_downgraded", "e"),
        event("subscription_activated", "invited", { currency: "GHS" })
      ],
      facts: [
        fact("free", "plans", "free"), fact("plus", "plans", "buddy_plus"), fact("pro", "plans", "buddy_pro"),
        fact("invited", "invites", "free", "invite_signup"), fact("invited", "core", "free", "profile_completed")
      ],
      planPrices: [{ plan: "buddy_plus", amountMinor: 499, currency: "GHS" }],
      now: new Date("2026-07-26T12:00:00.000Z"),
      rangeDays: 30
    });
    expect(report.lifecycle).toMatchObject({ failedPayments: 2, recoveredPayments: 1, recoveryRatePercent: 50, upgrades: 1, downgrades: 1, cancellations: 1 });
    expect(report.lifecycle.grossRevenueRetentionPercent).toBeNull();
    expect(report.featurePlans.find((row) => row.featureKey === "plans")).toMatchObject({ freeUsers: 1, plusUsers: 1, proUsers: 1 });
    expect(report.inviteAttribution).toMatchObject({ invitedUsers: 1, activatedInvitedUsers: 1, paidInvitedUsers: 1, inviteToPaidPercent: 100 });
  });
});
