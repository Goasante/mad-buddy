import { describe, expect, it } from "vitest";
import {
  freshnessLabel,
  getFreshnessState,
  ownerStalePresenceWarning,
  proximityActionsAllowed
} from "@/lib/proximity/freshness";

const NOW = Date.parse("2026-07-16T12:00:00.000Z");

describe("getFreshnessState (spec §44)", () => {
  it("classifies each band by age", () => {
    expect(getFreshnessState(NOW - 30 * 1000, NOW)).toBe("live");
    expect(getFreshnessState(NOW - 3 * 60 * 1000, NOW)).toBe("recent");
    expect(getFreshnessState(NOW - 10 * 60 * 1000, NOW)).toBe("older");
    expect(getFreshnessState(NOW - 40 * 60 * 1000, NOW)).toBe("stale");
  });

  it("treats a future timestamp (clock skew) as live, not precise", () => {
    expect(getFreshnessState(NOW + 5000, NOW)).toBe("live");
  });

  it("uses coarse labels that never expose an exact time", () => {
    expect(freshnessLabel("live")).toBe("Live");
    expect(freshnessLabel("stale")).toMatch(/outdated/);
    expect(freshnessLabel("recent")).not.toMatch(/\d/);
  });
});

describe("freshness gating (spec §47, §51)", () => {
  it("disables proximity actions only when stale", () => {
    expect(proximityActionsAllowed("live")).toBe(true);
    expect(proximityActionsAllowed("older")).toBe(true);
    expect(proximityActionsAllowed("stale")).toBe(false);
  });

  it("warns the owner only when their own presence is stale", () => {
    expect(ownerStalePresenceWarning("live")).toBeNull();
    expect(ownerStalePresenceWarning("stale")).toMatch(/location permission/);
  });
});
