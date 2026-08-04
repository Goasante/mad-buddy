import { describe, expect, it } from "vitest";
import { BUDDY_SCORE_LEVELS, BUDDY_SCORE_RULES, buddyScoreProgress, calculateBuddyScoreTotal, modelBuddyScorePace, resolveBuddyScoreLevel } from "@/lib/engagement/buddy-score";

describe("Buddy Score v1 rules", () => {
  it.each([
    [0, "New Buddy"], [199, "New Buddy"], [200, "Trusted Buddy"], [499, "Trusted Buddy"],
    [500, "Elite Buddy"], [999, "Elite Buddy"], [1000, "Legend Buddy"]
  ])("maps %i to %s", (score, label) => expect(resolveBuddyScoreLevel(score).label).toBe(label));

  it("calculates progress without exceeding its range", () => {
    expect(buddyScoreProgress(350)).toMatchObject({ pointsToNext: 150, percent: 50 });
    expect(buddyScoreProgress(1500)).toMatchObject({ pointsToNext: 0, percent: 100, next: null });
  });

  it("uses low-value, source-backed events rather than screen time or message contents", () => {
    expect(Object.keys(BUDDY_SCORE_RULES)).not.toContain("screen_time");
    expect(Object.keys(BUDDY_SCORE_RULES)).not.toContain("message_sent");
    expect(Math.max(...Object.values(BUDDY_SCORE_RULES).map((rule) => rule.points))).toBeLessThanOrEqual(50);
  });

  it("models difficult progression", () => {
    expect(BUDDY_SCORE_LEVELS.map((level) => level.minimum)).toEqual([0, 200, 500, 1000]);
    expect(modelBuddyScorePace().elite).toContain("months");
    expect(modelBuddyScorePace().legend).toContain("rare");
  });

  it("calculates trusted ledger totals and floors confirmed penalties at zero", () => {
    expect(calculateBuddyScoreTotal([{ points_delta: 50 }, { points_delta: 40 }, { points_delta: -25 }])).toBe(65);
    expect(calculateBuddyScoreTotal([{ points_delta: 20 }, { points_delta: -100 }])).toBe(0);
  });

  it("does not award premium purchases, popularity, or repetitive app activity", () => {
    const rules = Object.keys(BUDDY_SCORE_RULES);
    for (const disallowed of ["premium_purchased", "reaction_received", "screen_opened", "refresh", "scroll"]) {
      expect(rules).not.toContain(disallowed);
    }
  });
});
