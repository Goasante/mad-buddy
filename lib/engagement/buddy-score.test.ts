import { describe, expect, it } from "vitest";
import { calculateBuddyScore } from "@/lib/engagement/buddy-score";

describe("calculateBuddyScore", () => {
  it("uses real counts and caps every category", () => {
    const score = calculateBuddyScore({ friendships: 100, completedPlans: 100, messagesSent: 1000, achievementsEarned: 100, accountAgeDays: 1000 });
    expect(score.total).toBe(1000);
    expect(score.breakdown.every((item) => item.points <= item.maximum)).toBe(true);
  });

  it("returns zero for a new account with no activity", () => {
    expect(calculateBuddyScore({ friendships: 0, completedPlans: 0, messagesSent: 0, achievementsEarned: 0, accountAgeDays: 0 }).total).toBe(0);
  });
});
