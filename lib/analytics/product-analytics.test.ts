import { describe, expect, it } from "vitest";
import {
  addUtcDays,
  buildProductAnalyticsReport,
  PRODUCT_EVENT_NAMES,
  startOfUtcWeek,
  utcDay,
  type AnalyticsFact,
  type AnalyticsUser
} from "@/lib/analytics/product-analytics";

const now = new Date("2026-07-31T12:00:00.000Z");

function user(userId: string, signupDay: string, plan: AnalyticsUser["plan"] = "free"): AnalyticsUser {
  return { userId, signupAt: `${signupDay}T10:00:00.000Z`, plan };
}

function fact(
  userId: string,
  eventDate: string,
  eventName: string,
  featureKey = "core",
  actionCount = 1
): AnalyticsFact {
  return { userId, eventDate, eventName, featureKey, actionCount, subscriptionPlan: "free" };
}

describe("product analytics", () => {
  it("keeps the canonical event registry stable and unique", () => {
    expect(new Set(PRODUCT_EVENT_NAMES).size).toBe(PRODUCT_EVENT_NAMES.length);
    expect(PRODUCT_EVENT_NAMES).toEqual(expect.arrayContaining([
      "account_created",
      "profile_completed",
      "socialize_connection",
      "invite_signup",
      "subscription_started",
      "subscription_cancelled"
    ]));
  });

  it("uses stable UTC day and week boundaries", () => {
    expect(utcDay("2026-08-01T00:30:00+01:00")).toBe("2026-07-31");
    expect(addUtcDays("2026-07-31", 1)).toBe("2026-08-01");
    expect(startOfUtcWeek("2026-08-02")).toBe("2026-07-27");
    expect(startOfUtcWeek("2026-08-03")).toBe("2026-08-03");
  });

  it("calculates exact D1, D7, and D30 retention without double-counting actions", () => {
    const users = [user("a", "2026-07-01"), user("b", "2026-07-20")];
    const facts = [
      fact("a", "2026-07-02", "message_sent", "messages", 4),
      fact("a", "2026-07-08", "wave_sent", "wave", 2),
      fact("a", "2026-07-31", "plan_created", "plans"),
      fact("b", "2026-07-21", "message_sent", "messages")
    ];
    const report = buildProductAnalyticsReport({ users, milestones: [], facts, now, rangeDays: 30, planFilter: "all" });

    expect(report.retention).toEqual([
      { day: 1, eligibleUsers: 2, retainedUsers: 2, percent: 100 },
      { day: 7, eligibleUsers: 2, retainedUsers: 1, percent: 50 },
      { day: 30, eligibleUsers: 1, retainedUsers: 1, percent: 100 }
    ]);
  });

  it("calculates DAU, WAU, MAU from distinct meaningful users", () => {
    const users = [user("a", "2026-07-01"), user("b", "2026-07-02"), user("c", "2026-07-03")];
    const facts = [
      fact("a", "2026-07-31", "message_sent", "messages", 10),
      fact("a", "2026-07-31", "wave_sent", "wave", 3),
      fact("b", "2026-07-28", "plan_created", "plans"),
      fact("c", "2026-07-05", "moment_created", "moments")
    ];
    const report = buildProductAnalyticsReport({ users, milestones: [], facts, now, rangeDays: 30, planFilter: "all" });
    expect({ dau: report.dau, wau: report.wau, mau: report.mau, ratio: report.dauMauRatio }).toEqual({
      dau: 1,
      wau: 2,
      mau: 3,
      ratio: 33.3
    });
  });

  it("does not limit active-user metrics to the selected signup cohort", () => {
    const report = buildProductAnalyticsReport({
      users: [user("new", "2026-07-31")],
      milestones: [],
      facts: [
        fact("new", "2026-07-31", "message_sent", "messages"),
        fact("established", "2026-07-31", "wave_sent", "wave")
      ],
      now,
      rangeDays: 7,
      planFilter: "all"
    });
    expect(report.trackedUsers).toBe(1);
    expect(report.dau).toBe(2);
  });

  it("keeps the activation funnel progressive and exposes real drop-off", () => {
    const users = [user("a", "2026-07-01"), user("b", "2026-07-01"), user("c", "2026-07-01")];
    const milestones = [
      { userId: "a", milestone: "profile_completed", reachedAt: "2026-07-01T11:00:00Z" },
      { userId: "a", milestone: "first_muddy_added", reachedAt: "2026-07-02T11:00:00Z" },
      { userId: "b", milestone: "profile_completed", reachedAt: "2026-07-01T11:00:00Z" }
    ];
    const facts = [
      fact("a", "2026-07-02", "muddy_added", "core", 2),
      fact("a", "2026-07-03", "message_sent", "messages"),
      fact("a", "2026-07-10", "wave_sent", "wave")
    ];
    const report = buildProductAnalyticsReport({ users, milestones, facts, now, rangeDays: 30, planFilter: "all" });
    expect(report.funnel.map((step) => step.count)).toEqual([3, 2, 1, 1, 1, 1]);
    expect(report.funnel[1]).toMatchObject({ conversionPercent: 66.7, dropOffPercent: 33.3 });
  });

  it("aggregates feature usage and preserves history when its current flag is disabled", () => {
    const users = [user("a", "2026-07-01"), user("b", "2026-07-01")];
    const facts = [
      fact("a", "2026-07-03", "socialize_enabled", "socialize", 2),
      fact("a", "2026-07-08", "message_sent", "messages"),
      fact("b", "2026-07-08", "message_sent", "messages")
    ];
    const report = buildProductAnalyticsReport({
      users,
      milestones: [],
      facts,
      now,
      rangeDays: 30,
      planFilter: "all",
      flagStatuses: { socialize: "Disabled" }
    });
    const socialize = report.features.find((feature) => feature.key === "socialize");
    expect(socialize).toMatchObject({ activeUsers: 1, totalActions: 2, actionsPerUser: 2, flagStatus: "Disabled" });
    expect(socialize?.retentionAssociation).toBe("similar");
  });

  it("applies subscription filters without counting users from other plans", () => {
    const users = [user("free", "2026-07-01"), user("plus", "2026-07-01", "buddy_plus")];
    const facts = [
      fact("free", "2026-07-31", "message_sent", "messages"),
      fact("plus", "2026-07-31", "message_sent", "messages")
    ];
    const report = buildProductAnalyticsReport({ users, milestones: [], facts, now, rangeDays: 30, planFilter: "buddy_plus" });
    expect(report.trackedUsers).toBe(1);
    expect(report.dau).toBe(1);
    expect(report.funnel[0].count).toBe(1);
  });

  it("uses the current user plan for activity filters", () => {
    const report = buildProductAnalyticsReport({
      users: [],
      milestones: [],
      facts: [
        fact("free", "2026-07-31", "message_sent", "messages"),
        fact("plus", "2026-07-31", "message_sent", "messages")
      ],
      currentPlanByUser: new Map([
        ["free", "free"],
        ["plus", "buddy_plus"]
      ]),
      now,
      rangeDays: 30,
      planFilter: "buddy_plus"
    });
    expect(report.dau).toBe(1);
    expect(report.features.find((feature) => feature.key === "wave")?.activeUsers).toBe(0);
  });

  it("marks recent cohorts ineligible instead of reporting false zero retention", () => {
    const report = buildProductAnalyticsReport({
      users: [user("new", "2026-07-31")],
      milestones: [],
      facts: [],
      now,
      rangeDays: 7,
      planFilter: "all"
    });
    expect(report.retention.map((item) => item.percent)).toEqual([null, null, null]);
    expect(report.cohorts[0]).toMatchObject({ d1: null, d7: null, d30: null });
  });
});
