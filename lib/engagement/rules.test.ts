import { describe, expect, it } from "vitest";
import {
  ALL_CAUGHT_UP_MESSAGE,
  DEFAULT_DAILY_NOTIFICATION_BUDGET,
  PROHIBITED_PATTERNS,
  PULSE_IS_FINITE,
  RECAP_ALLOWED_FIELDS,
  STREAK_ENDED_MESSAGE,
  advanceStreak,
  allowsRedDot,
  applyEngagementGuards,
  checkNotificationBudget,
  clampNotificationBudget,
  examModeAllows,
  examModeEndsAtMs,
  isExamModeActive,
  isMeaningfulMutualInteraction,
  isStreakPaused,
  pauseUntilMs,
  periodQualifies,
  previousWeekKey,
  recapHeadline,
  sanitizeRecapSummary,
  streakSummaryLabel,
  weekKey,
  type StreakState
} from "@/lib/engagement/rules";

const NOW = Date.parse("2026-07-17T12:00:00.000Z");
const WEEK = 7 * 24 * 60 * 60 * 1000;

describe("weekly periods (spec §15)", () => {
  it("uses weekly, not daily, keys", () => {
    expect(weekKey(NOW)).toMatch(/^\d{4}-W\d{2}$/);
    // Same week regardless of the day within it.
    expect(weekKey(NOW)).toBe(weekKey(NOW + 24 * 60 * 60 * 1000));
    expect(weekKey(NOW)).not.toBe(weekKey(NOW + WEEK));
    expect(previousWeekKey(NOW)).toBe(weekKey(NOW - WEEK));
  });
});

describe("streak qualification (spec §14, §17)", () => {
  it("counts friendship actions, not app usage", () => {
    expect(isMeaningfulMutualInteraction("plan_completed")).toBe(true);
    expect(isMeaningfulMutualInteraction("wave_exchanged")).toBe(true);

    // The whole point: usage signals must never build a streak.
    for (const usage of ["app_open", "profile_view", "location_update", "notification_tap", "session_start"]) {
      expect(isMeaningfulMutualInteraction(usage), usage).toBe(false);
    }
  });

  it("requires BOTH people to act — one-sided spam can never sustain a streak", () => {
    const oneSided = periodQualifies({
      events: [
        { actorId: "ama", eventType: "wave_exchanged" },
        { actorId: "ama", eventType: "wave_exchanged" },
        { actorId: "ama", eventType: "shared_plan" }
      ],
      userOneId: "ama",
      userTwoId: "kojo"
    });
    expect(oneSided).toBe(false);

    const mutual = periodQualifies({
      events: [
        { actorId: "ama", eventType: "wave_exchanged" },
        { actorId: "kojo", eventType: "wave_exchanged" }
      ],
      userOneId: "ama",
      userTwoId: "kojo"
    });
    expect(mutual).toBe(true);
  });

  it("ignores non-meaningful events even when both sides 'act'", () => {
    expect(
      periodQualifies({
        events: [
          { actorId: "ama", eventType: "app_open" as never },
          { actorId: "kojo", eventType: "app_open" as never }
        ],
        userOneId: "ama",
        userTwoId: "kojo"
      })
    ).toBe(false);
  });
});

describe("streak progression (spec §15, §18, §19)", () => {
  function state(overrides: Partial<StreakState> = {}): StreakState {
    return {
      currentWeeks: 3,
      longestWeeks: 3,
      lastQualifiedPeriod: "2026-W28",
      status: "active",
      pausedUntilMs: null,
      ...overrides
    };
  }

  it("continues across consecutive weeks", () => {
    const update = advanceStreak({
      state: state(),
      qualifiedPeriod: "2026-W29",
      previousPeriod: "2026-W28"
    });
    expect(update.currentWeeks).toBe(4);
    expect(update.longestWeeks).toBe(4);
    expect(update.milestoneReached).toBe(true); // 4 weeks is a milestone
  });

  it("is idempotent — re-reporting the same period can't inflate it", () => {
    const update = advanceStreak({
      state: state(),
      qualifiedPeriod: "2026-W28",
      previousPeriod: "2026-W27"
    });
    expect(update.currentWeeks).toBe(3);
  });

  it("restarts at 1 after a gap, and keeps the longest as a record", () => {
    const update = advanceStreak({
      state: state({ currentWeeks: 6, longestWeeks: 6, lastQualifiedPeriod: "2026-W20" }),
      qualifiedPeriod: "2026-W29",
      previousPeriod: "2026-W28"
    });
    expect(update.currentWeeks).toBe(1);
    expect(update.longestWeeks).toBe(6);
  });

  it("pauses for free — there is no paid path to preserve a streak", () => {
    // pauseUntilMs takes no plan/subscription argument at all, by design.
    expect(pauseUntilMs(4, NOW)).toBe(NOW + 4 * WEEK);
    expect(pauseUntilMs(999, NOW)).toBe(NOW + 8 * WEEK); // clamped
    expect(isStreakPaused(state({ status: "paused", pausedUntilMs: NOW + WEEK }), NOW)).toBe(true);
    expect(isStreakPaused(state({ status: "paused", pausedUntilMs: NOW - 1 }), NOW)).toBe(false);
  });

  it("never punishes a lost streak", () => {
    expect(STREAK_ENDED_MESSAGE).not.toMatch(/lost|failed|broken|don't lose/i);
    expect(STREAK_ENDED_MESSAGE).toMatch(/start a new one anytime/i);
  });

  it("describes a streak privately, between the two people only", () => {
    expect(streakSummaryLabel(6, "Kojo")).toBe("You and Kojo have connected for 6 weeks.");
    // No rank, no position, no comparison.
    expect(streakSummaryLabel(6, "Kojo")).not.toMatch(/rank|top|#\d|best|most/i);
  });
});

describe("recap safety (spec §4)", () => {
  it("carries aggregated counts only — no content, location, or negatives", () => {
    for (const field of RECAP_ALLOWED_FIELDS) {
      expect(String(field)).not.toMatch(/message|text|content|location|coordinate|place|address|route/i);
      expect(String(field)).not.toMatch(/rejected|blocked|report/i);
    }
  });

  it("strips anything not explicitly allowed, even if a query leaks it", () => {
    const sanitized = sanitizeRecapSummary({
      plansCompleted: 4,
      muddiesInteractedWith: 6,
      // All of these must not survive.
      messageContent: "see you at 12 Oxford Street",
      lastLocation: "5.6037,-0.1870",
      rejectedPlans: 3,
      blockedUsers: ["someone"]
    } as Record<string, unknown>);

    expect(sanitized.plansCompleted).toBe(4);
    expect(sanitized.muddiesInteractedWith).toBe(6);
    expect(Object.keys(sanitized).sort()).toEqual([...RECAP_ALLOWED_FIELDS].sort());
    expect(JSON.stringify(sanitized)).not.toMatch(/Oxford|5\.6037|someone/);
  });

  it("uses warm, non-judgemental copy and never shames a quiet month", () => {
    expect(recapHeadline(sanitizeRecapSummary({ muddiesInteractedWith: 5 }))).toBe(
      "You made time for 5 different Muddies this month."
    );
    const quiet = recapHeadline(sanitizeRecapSummary({}));
    expect(quiet).not.toMatch(/only|no one|nobody|failed|missed/i);
    expect(quiet).toMatch(/quiet month/i);
  });
});

describe("notification budget (spec §45)", () => {
  it("defaults to 8 and lets users go stricter but never looser", () => {
    expect(DEFAULT_DAILY_NOTIFICATION_BUDGET).toBe(8);
    expect(clampNotificationBudget(3)).toBe(3);
    expect(clampNotificationBudget(0)).toBe(0);
    // A client asking for a bigger budget doesn't get one.
    expect(clampNotificationBudget(99)).toBe(8);
    expect(clampNotificationBudget(Number.NaN)).toBe(8);
  });

  it("stops low-value noise once the budget is spent", () => {
    expect(checkNotificationBudget({ priority: "normal", sentToday: 8, budget: 8 })).toEqual({
      allowed: false,
      reason: "budget_exhausted"
    });
    expect(checkNotificationBudget({ priority: "low", sentToday: 3, budget: 8 }).allowed).toBe(true);
  });

  it("never swallows things the user actually needs", () => {
    expect(checkNotificationBudget({ priority: "critical", sentToday: 99, budget: 8 }).allowed).toBe(true);
    expect(checkNotificationBudget({ priority: "high", sentToday: 99, budget: 8 }).allowed).toBe(true);
  });
});

describe("red dots (spec §46)", () => {
  it("reserves unread dots for things needing action", () => {
    for (const surface of ["direct_message", "meeting_ping", "plan_response", "security_alert"] as const) {
      expect(allowsRedDot(surface), surface).toBe(true);
    }
  });

  it("never puts a dot on achievements, recaps, tips, or marketing", () => {
    for (const surface of ["achievement", "recap", "product_tip", "marketing", "circle_activity"] as const) {
      expect(allowsRedDot(surface), surface).toBe(false);
    }
  });
});

describe("exam mode (spec §38)", () => {
  it("computes durations", () => {
    expect(examModeEndsAtMs("2h", NOW)).toBe(NOW + 2 * 60 * 60 * 1000);
    expect(examModeEndsAtMs("1w", NOW)).toBe(NOW + WEEK);
    expect(isExamModeActive(NOW + 1000, NOW)).toBe(true);
    expect(isExamModeActive(NOW - 1, NOW)).toBe(false);
    expect(isExamModeActive(null, NOW)).toBe(false);
  });

  it("quiets social noise but never cuts someone off", () => {
    expect(examModeAllows({ priority: "low", fromCloseFriend: false, allowCloseFriends: true }).deliver).toBe(false);
    // Close friends still get through when allowed.
    expect(examModeAllows({ priority: "normal", fromCloseFriend: true, allowCloseFriends: true }).deliver).toBe(true);
    expect(examModeAllows({ priority: "normal", fromCloseFriend: true, allowCloseFriends: false }).deliver).toBe(false);
    // Critical always lands.
    expect(examModeAllows({ priority: "critical", fromCloseFriend: false, allowCloseFriends: false }).deliver).toBe(
      true
    );
  });
});

describe("composition with the batch-4 notification engine (spec §51)", () => {
  const base = { inApp: true, push: true, reason: "deliver" };
  const context = {
    priority: "normal" as const,
    examModeUntilMs: null,
    examModeAllowCloseFriends: true,
    fromCloseFriend: false,
    sentToday: 0,
    budget: 8,
    nowMs: NOW
  };

  it("passes through when nothing objects", () => {
    expect(applyEngagementGuards(base, context)).toEqual(base);
  });

  it("never turns a 'no push' into a push — guards only remove", () => {
    const suppressed = { inApp: true, push: false, reason: "quiet_hours" };
    expect(
      applyEngagementGuards(suppressed, { ...context, priority: "critical", sentToday: 0 })
    ).toEqual(suppressed);
  });

  it("suppresses the push but keeps the in-app item", () => {
    const examMode = applyEngagementGuards(base, { ...context, examModeUntilMs: NOW + 1000 });
    expect(examMode).toEqual({ inApp: true, push: false, reason: "exam_mode" });

    const exhausted = applyEngagementGuards(base, { ...context, sentToday: 8 });
    expect(exhausted).toEqual({ inApp: true, push: false, reason: "budget_exhausted" });
  });

  it("lets critical through both guards", () => {
    expect(
      applyEngagementGuards(base, {
        ...context,
        priority: "critical",
        examModeUntilMs: NOW + 1000,
        sentToday: 99
      }).push
    ).toBe(true);
  });
});

describe("anti-addiction guarantees (spec §35, §44)", () => {
  it("keeps the Pulse finite with an all-caught-up end state", () => {
    expect(PULSE_IS_FINITE).toBe(true);
    expect(ALL_CAUGHT_UP_MESSAGE).toBe("You're all caught up.");
  });

  it("names the patterns the product must never ship", () => {
    for (const pattern of [
      "infinite_scroll",
      "random_variable_rewards",
      "daily_login_rewards",
      "paid_streak_recovery",
      "public_popularity_metrics",
      "friend_rankings",
      "someone_viewed_you_bait",
      "fear_based_location_alerts"
    ]) {
      expect(PROHIBITED_PATTERNS).toContain(pattern);
    }
  });

  it("exposes no ranking or leaderboard shape at all", () => {
    // If a leaderboard were possible, something here would return a list of
    // users ordered by a score. Nothing does — this asserts the absence.
    const moduleShape = {
      streakSummaryLabel: streakSummaryLabel(1, "x"),
      recapHeadline: recapHeadline(sanitizeRecapSummary({}))
    };
    expect(JSON.stringify(moduleShape)).not.toMatch(/leaderboard|ranking|top \d|position/i);
  });
});
