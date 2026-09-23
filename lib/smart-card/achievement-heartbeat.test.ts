import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(__dirname, "..", "..", path), "utf8");

const dashboard = read("app/(app)/dashboard/page.tsx");
const projection = read("lib/smart-card/home-projection.ts");
const action = read("app/(app)/smart-card-actions.ts");
const renderer = read("components/journey/smart-card-v2.tsx");
const smartCard = read("lib/smart-card/smart-card.ts");

describe("achievement heartbeat production wiring", () => {
  it("feeds a real recent achievement into Home instead of hardcoding null", () => {
    expect(projection).toContain("loadRecentAchievement");
    expect(projection).toContain('from("user_achievements")');
    expect(projection).toContain("HOME_ACHIEVEMENT_RECENCY_MS");
    expect(dashboard).toContain("recentAchievement: smartCardProjection?.recentAchievement ?? null");
    expect(dashboard).not.toContain("recentAchievement: null");
  });

  it("retires the specific badge rather than the entire achievement family", () => {
    expect(renderer).toContain("card.acknowledgementKey ?? card.id");
    expect(action).toContain('acknowledgementKey.startsWith("achievement:")');
    expect(action).toContain("ACHIEVEMENT_BY_CODE.has(achievementCode)");
    expect(smartCard).toContain("card.acknowledgementKey ?? card.id");
  });

  it("lets a bounded new achievement beat evergreen Journey/score prompts", () => {
    const complete = smartCard.indexOf('"journey_complete"');
    const achievement = smartCard.indexOf('"achievement"', complete);
    const journey = smartCard.indexOf('"journey"', achievement);
    const score = smartCard.indexOf('"buddy_progress"', achievement);

    expect(complete).toBeGreaterThanOrEqual(0);
    expect(achievement).toBeGreaterThan(complete);
    expect(journey).toBeGreaterThan(achievement);
    expect(score).toBeGreaterThan(achievement);
  });
});
