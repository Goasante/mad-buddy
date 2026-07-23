import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_MAINTENANCE_MESSAGE,
  getMaintenanceCache,
  isMaintenanceCacheStale,
  maintenanceMessageOrDefault,
  resetMaintenanceCache,
  setMaintenanceCache,
  shouldBlockForMaintenance
} from "@/lib/maintenance/state";

beforeEach(() => {
  resetMaintenanceCache();
});

describe("who maintenance mode applies to", () => {
  it("blocks ordinary users while maintenance is on", () => {
    expect(shouldBlockForMaintenance({ isActive: true, isStaff: false })).toBe(true);
  });

  it("never blocks staff, someone must be able to turn it back off", () => {
    expect(shouldBlockForMaintenance({ isActive: true, isStaff: true })).toBe(false);
  });

  it("blocks nobody when maintenance is off", () => {
    expect(shouldBlockForMaintenance({ isActive: false, isStaff: false })).toBe(false);
    expect(shouldBlockForMaintenance({ isActive: false, isStaff: true })).toBe(false);
  });
});

describe("maintenance message", () => {
  it("falls back to the default when unset, empty, or whitespace", () => {
    for (const value of [null, undefined, "", "   "]) {
      expect(maintenanceMessageOrDefault(value)).toBe(DEFAULT_MAINTENANCE_MESSAGE);
    }
  });

  it("keeps a real message, trimmed", () => {
    expect(maintenanceMessageOrDefault("  Back at 09:00 GMT  ")).toBe("Back at 09:00 GMT");
  });
});

describe("cache", () => {
  it("starts empty and stale so the first read always loads", () => {
    expect(getMaintenanceCache()).toEqual({ isActive: false, message: "" });
    expect(isMaintenanceCacheStale(30_000)).toBe(true);
  });

  it("is fresh right after a write and stale past the TTL", () => {
    setMaintenanceCache({ isActive: true, message: "Upgrading" });
    expect(getMaintenanceCache()).toEqual({ isActive: true, message: "Upgrading" });
    expect(isMaintenanceCacheStale(30_000)).toBe(false);
    expect(isMaintenanceCacheStale(-1)).toBe(true);
  });
});
