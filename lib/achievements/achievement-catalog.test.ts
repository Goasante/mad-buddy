import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ACHIEVEMENT_BY_CODE,
  ACHIEVEMENT_CATALOG,
  achievementIconPath
} from "@/lib/achievements/achievement-catalog";

// The seeded rows are the granting authority; the catalog must stay in lockstep.
const MIGRATION = readFileSync(
  join(process.cwd(), "supabase/migrations/20260717240000_recaps_streaks_achievements.sql"),
  "utf8"
);

function seededCodes(): { code: string; type: string; value: number }[] {
  const rows: { code: string; type: string; value: number }[] = [];
  // e.g. ('first_muddy', 'First Muddy', 'You added…', 'connection', 'first_time', 1),
  const pattern = /\(\s*'([a-z_]+)',\s*'[^']*',\s*'[^']*',\s*'[a-z]+',\s*'([a-z_]+)',\s*(\d+)\s*\)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(MIGRATION)) !== null) {
    rows.push({ code: match[1], type: match[2], value: Number(match[3]) });
  }
  return rows;
}

describe("achievement catalog", () => {
  it("has unique ids", () => {
    const ids = ACHIEVEMENT_CATALOG.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("covers exactly the seeded achievement_definitions codes", () => {
    const seeded = seededCodes();
    expect(seeded.length).toBeGreaterThan(0);
    const seededCodeSet = new Set(seeded.map((row) => row.code));
    const catalogCodeSet = new Set(ACHIEVEMENT_CATALOG.map((a) => a.id));
    expect(catalogCodeSet).toEqual(seededCodeSet);
  });

  it("matches the seeded criteria type and threshold for every code", () => {
    for (const row of seededCodes()) {
      const def = ACHIEVEMENT_BY_CODE.get(row.code);
      expect(def, `catalog missing ${row.code}`).toBeDefined();
      expect(def!.criteria.type).toBe(row.type);
      expect(def!.criteria.threshold).toBe(row.value);
    }
  });

  it("points every badge at a local asset that exists on disk", () => {
    for (const achievement of ACHIEVEMENT_CATALOG) {
      expect(achievement.iconPath.startsWith("/icons/features/navigation/badges/")).toBe(true);
      const diskPath = join(process.cwd(), "public", achievement.iconPath);
      expect(existsSync(diskPath), `missing asset for "${achievement.id}" at ${achievement.iconPath}`).toBe(true);
    }
  });

  it("never hotlinks an external asset", () => {
    for (const achievement of ACHIEVEMENT_CATALOG) {
      expect(achievement.iconPath).not.toMatch(/^https?:\/\//);
    }
  });

  it("gives every achievement unlock notification copy naming the badge", () => {
    for (const achievement of ACHIEVEMENT_CATALOG) {
      expect(achievement.notification.title.length).toBeGreaterThan(0);
      expect(achievement.notification.body).toContain(achievement.name);
    }
  });

  it("resolves icon paths by code and returns null for unknown codes", () => {
    expect(achievementIconPath("first_muddy")).toContain("First Muddy.png");
    expect(achievementIconPath("___nope___")).toBeNull();
  });
});
