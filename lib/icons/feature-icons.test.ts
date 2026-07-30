import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FEATURE_ICON_CREDITS,
  FEATURE_ICON_KEYS,
  FEATURE_ICON_SOURCES,
  featureIconSource,
  type FeatureIconKey
} from "@/lib/icons/feature-icons";

const REQUIRED_KEYS: FeatureIconKey[] = [
  "moments",
  "safeArrival",
  "hangout",
  "events",
  "groups",
  "socialize",
  "invites",
  "reminders",
  "focus",
  "plans",
  "ping",
  "wave"
];

describe("feature icon mapping", () => {
  it("defines every required feature key", () => {
    for (const key of REQUIRED_KEYS) {
      expect(FEATURE_ICON_SOURCES[key]).toBeDefined();
    }
    expect(FEATURE_ICON_KEYS.sort()).toEqual([...REQUIRED_KEYS].sort());
  });

  it("maps every key to a local asset that exists on disk", () => {
    for (const key of REQUIRED_KEYS) {
      const { src } = featureIconSource(key);
      expect(src.startsWith("/icons/features/")).toBe(true);
      const diskPath = join(process.cwd(), "public", src);
      expect(existsSync(diskPath), `missing asset for "${key}" at ${src}`).toBe(true);
    }
  });

  it("never hotlinks or fetches from an external host", () => {
    for (const { src } of Object.values(FEATURE_ICON_SOURCES)) {
      expect(src).not.toMatch(/^https?:\/\//);
      expect(src.toLowerCase()).not.toContain("flaticon");
    }
  });

  it("gives every icon a human label for accessible (non-decorative) use", () => {
    for (const key of REQUIRED_KEYS) {
      expect(featureIconSource(key).label.length).toBeGreaterThan(0);
    }
  });
});

describe("feature icon attribution", () => {
  it("credits every Flaticon source it still uses, and only those", () => {
    // Hangout is no longer a Flaticon asset (it is the in-project
    // hangout-linkup.svg), so its credit was removed rather than left
    // attributing an author whose work is not being used. The count follows the
    // assets rather than being pinned to a number that has to be edited by hand.
    const flaticonAssets = FEATURE_ICON_KEYS.filter(
      (key) => !FEATURE_ICON_SOURCES[key].src.endsWith(".svg")
    );
    expect(FEATURE_ICON_CREDITS).toHaveLength(flaticonAssets.length);
    for (const credit of FEATURE_ICON_CREDITS) {
      expect(credit.author.length).toBeGreaterThan(0);
      expect(credit.href).toContain("flaticon.com");
    }
  });
});
