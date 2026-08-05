import { describe, expect, it } from "vitest";
import {
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

  // These used to be third-party raster assets served from /public. They are
  // Lucide components now, so there is no file to exist on disk, no external
  // host to hotlink from, and no attribution to keep in sync — which is why
  // the asset-path and Flaticon-credit cases this file used to carry are gone
  // rather than rewritten.
  it("maps every key to a renderable icon component", () => {
    for (const key of REQUIRED_KEYS) {
      const { icon } = featureIconSource(key);
      expect(typeof icon === "function" || typeof icon === "object", `"${key}" is not a component`).toBe(true);
    }
  });

  it("gives every icon a human label for accessible (non-decorative) use", () => {
    for (const key of REQUIRED_KEYS) {
      expect(featureIconSource(key).label.length).toBeGreaterThan(0);
    }
  });
});
