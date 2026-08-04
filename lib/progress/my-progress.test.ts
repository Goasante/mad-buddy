import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { BuddyScoreData } from "@/lib/engagement/buddy-score-service";
import { completedProgressMilestones, featuredAchievements, progressTimeline, type ProgressAchievement } from "@/lib/progress/my-progress";

const score: BuddyScoreData = {
  total: 245,
  level: { key: "trusted", label: "Trusted Buddy", minimum: 200 },
  nextLevel: { key: "elite", label: "Elite Buddy", minimum: 500 },
  pointsToNext: 255,
  progressPercent: 15,
  categories: [],
  recentActivity: [
    { id: "plan", eventType: "plan_completed", label: "Completed plan", category: "Plans", points: 40, createdAt: "2026-07-04T12:00:00.000Z" },
    { id: "achievement-ledger", eventType: "achievement_earned", label: "Achievement earned", category: "Achievements", points: 25, createdAt: "2026-07-03T12:00:00.000Z" }
  ],
  earnedReward: null
};

const achievements: ProgressAchievement[] = [
  { code: "first_plan", name: "First Plan", description: "Completed a Plan.", iconPath: null, earnedAt: "2026-07-05T12:00:00.000Z" },
  { code: "first_muddy", name: "First Muddy", description: "Added a Muddy.", iconPath: null, earnedAt: "2026-07-02T12:00:00.000Z" }
];

describe("My Progress projection", () => {
  it("shows only meaningful completed activation milestones", () => {
    expect(completedProgressMilestones([
      { milestone: "account_created", reached_at: "2026-07-01T00:00:00.000Z" },
      { milestone: "email_verified", reached_at: "2026-07-02T00:00:00.000Z" },
      { milestone: "first_muddy_added", reached_at: "2026-07-03T00:00:00.000Z" }
    ])).toEqual([
      { key: "email_verified", label: "Email verified", reachedAt: "2026-07-02T00:00:00.000Z" },
      { key: "first_muddy_added", label: "First Muddy added", reachedAt: "2026-07-03T00:00:00.000Z" }
    ]);
  });

  it("reuses recent earned achievements as the compact featured set", () => {
    expect(featuredAchievements(achievements, 1)).toEqual([achievements[0]]);
  });

  it("combines score events and achievements chronologically without duplicating generic achievement ledger rows", () => {
    const timeline = progressTimeline(score, achievements);
    expect(timeline.map((item) => item.label)).toEqual(["First Plan", "Completed plan", "First Muddy"]);
    expect(timeline.some((item) => item.label === "Achievement earned")).toBe(false);
  });

  it("keeps the existing owner-authenticated API and route instead of creating a duplicate page", () => {
    const route = readFileSync("app/api/buddy-score/route.ts", "utf8");
    const page = readFileSync("app/(app)/buddy-score/page.tsx", "utf8");
    expect(route).toContain("resolveApiUser");
    expect(route).toContain("loadMyProgress");
    expect(page).toContain("BuddyScorePage");
  });

  it("uses the live canonical Journey projection and excludes streak/confetti mechanics", () => {
    const page = readFileSync("components/buddy-score/buddy-score-page.tsx", "utf8");
    expect(page).toContain("JourneyProgress journey={journey}");
    expect(page).not.toContain("Coming in the next milestone.");
    expect(page.toLowerCase()).not.toContain("streak");
    expect(page.toLowerCase()).not.toContain("confetti");
  });
});
