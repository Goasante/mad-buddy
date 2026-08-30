import { describe, expect, it } from "vitest";
import {
  OWNED_UPFOR_LIMIT,
  canOfferAnotherUpFor,
  orderOwnedUpFors,
  ownedUpForCapacityLabel,
  ownedUpForTimeLabel,
  ownedUpForViews,
  type OwnedUpFor
} from "@/lib/social/owned-upfors";

const NOW = Date.parse("2026-07-17T14:00:00Z");
const at = (min: number) => new Date(NOW + min * 60_000).toISOString();

const upfor = (
  id: string,
  startMin: number,
  endMin: number,
  status = "active"
): OwnedUpFor => ({
  id,
  activityType: "coffee",
  audienceType: "all_muddies",
  message: null,
  status,
  startsAt: at(startMin),
  endsAt: at(endMin)
});

describe("the owner sees every UpFor they hold", () => {
  it("shows nothing when there are none", () => {
    expect(orderOwnedUpFors([], NOW)).toEqual([]);
  });

  it("shows one", () => {
    expect(orderOwnedUpFors([upfor("a", -10, 50)], NOW)).toHaveLength(1);
  });

  it("shows two at once -- creating B never hides A", () => {
    const rows = orderOwnedUpFors([upfor("a", -10, 50), upfor("b", 120, 240)], NOW);
    expect(rows.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("shows all three at once", () => {
    const rows = orderOwnedUpFors(
      [upfor("a", -10, 50), upfor("b", 120, 240), upfor("c", 300, 420)],
      NOW
    );
    expect(rows.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("drops terminal sessions from the owner's active collection", () => {
    for (const status of ["cancelled", "expired", "converted_to_plan"] as const) {
      // Given a window that has NOT elapsed, so only the lifecycle excludes it.
      expect(orderOwnedUpFors([upfor("x", -10, 60, status)], NOW), status).toEqual([]);
    }
  });
});

describe("ordering is deterministic and boring on purpose", () => {
  it("puts live before scheduled, whatever order they arrive in", () => {
    const rows = orderOwnedUpFors([upfor("later", 200, 320), upfor("live", -5, 40)], NOW);
    expect(rows.map((r) => r.id)).toEqual(["live", "later"]);
  });

  it("orders scheduled by when they start", () => {
    const rows = orderOwnedUpFors([upfor("nine", 300, 420), upfor("six", 150, 270)], NOW);
    expect(rows.map((r) => r.id)).toEqual(["six", "nine"]);
  });

  it("does not reshuffle between renders", () => {
    const rows = [upfor("a", 120, 240), upfor("b", 120, 240)];
    expect(orderOwnedUpFors(rows, NOW).map((r) => r.id)).toEqual(
      orderOwnedUpFors(rows, NOW).map((r) => r.id)
    );
  });
});

describe("live and scheduled are obvious without colour", () => {
  it("says Live now, in words", () => {
    // State carried by text, never by an orange dot alone.
    expect(ownedUpForTimeLabel(upfor("a", -10, 42), NOW, "en-GB")).toBe("Live now · 42m left");
  });

  it("names the start time and the wait for a scheduled one", () => {
    const label = ownedUpForTimeLabel(upfor("b", 78, 200), NOW, "en-GB");
    expect(label).toMatch(/^Starts \d{1,2}:\d{2}/);
    expect(label).toContain("in 1h 18m");
  });

  it("exposes no database vocabulary", () => {
    const label = ownedUpForTimeLabel(upfor("b", 78, 200), NOW, "en-GB");
    for (const leak of ["status", "starts_at", "ends_at", "active", "discovery_scope"]) {
      expect(label, leak).not.toContain(leak);
    }
  });

  it("transitions from scheduled to live as the clock passes the start", () => {
    // The same row, no refresh, no stored status: only the clock moved.
    const row = upfor("b", 30, 150);
    expect(ownedUpForViews([row], NOW)[0]!.phase).toBe("scheduled");
    expect(ownedUpForViews([row], NOW + 31 * 60_000)[0]!.phase).toBe("live");
  });
});

describe("capacity is explained, never enforced here", () => {
  it("offers another while under the limit", () => {
    expect(canOfferAnotherUpFor([], NOW)).toBe(true);
    expect(canOfferAnotherUpFor([upfor("a", -10, 50)], NOW)).toBe(true);
    expect(canOfferAnotherUpFor([upfor("a", -10, 50), upfor("b", 60, 180)], NOW)).toBe(true);
  });

  it("stops offering at three", () => {
    const three = [upfor("a", -10, 50), upfor("b", 60, 180), upfor("c", 200, 320)];
    expect(canOfferAnotherUpFor(three, NOW)).toBe(false);
    expect(OWNED_UPFOR_LIMIT).toBe(3);
  });

  it("counts a terminal session as freeing capacity", () => {
    const rows = [upfor("a", -10, 50), upfor("b", 60, 180), upfor("c", 200, 320, "cancelled")];
    expect(canOfferAnotherUpFor(rows, NOW)).toBe(true);
  });

  it("states capacity in plain words", () => {
    expect(ownedUpForCapacityLabel([upfor("a", -10, 50), upfor("b", 60, 180)], NOW)).toBe(
      "2 of 3 today"
    );
  });
});
