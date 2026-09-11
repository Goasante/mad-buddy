import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { proximityBandRangeLabel, type ProximityBand } from "@/lib/proximity/bands";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

const muddiesRail = read("components/friends/muddies-closest-rail.tsx");
const muddiesGrid = read("components/friends/muddies-grid.tsx");
const home = read("components/dashboard/dashboard-page.tsx");

describe("proximity range vocabulary", () => {
  it.each([
    ["right_here", "0–100 m"],
    ["around_you", "100–500 m"],
    ["close_by", "500 m–2 km"],
    ["nearby", "2–5 km"],
    ["around_town", "5–10 km"],
    ["further_away", "10–15 km"]
  ] as Array<[ProximityBand, string]>)("%s is explained as %s", (band, range) => {
    expect(proximityBandRangeLabel(band)).toBe(range);
  });

  it("keeps 15 km as the outer edge rather than implying 15 km plus", () => {
    expect(proximityBandRangeLabel("further_away")).toBe("10–15 km");
    expect(proximityBandRangeLabel("outside_range")).toBeNull();
  });
});

describe("range copy is limited to Glow-led teaching surfaces", () => {
  it("shows the canonical helper on the Muddies closest rail", () => {
    expect(muddiesRail).toContain("proximityBandRangeLabel");
    expect(muddiesRail).toContain("text-[10px]");
    expect(muddiesRail).toContain("text-muted-foreground/75");
  });

  it("shows the canonical helper on Home Near", () => {
    expect(home).toContain("proximityBandRangeLabel");
    expect(home).toContain("text-[10px] font-medium leading-3 text-muted-foreground/70");
  });

  it("does not add numeric range copy to the regular Muddies grid", () => {
    expect(muddiesGrid).not.toContain("proximityBandRangeLabel");
    expect(muddiesGrid).not.toMatch(/0[–-]100\s*m|100[–-]500\s*m|10[–-]15\s*km/);
  });
});
