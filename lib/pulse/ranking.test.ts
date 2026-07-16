import { describe, expect, it } from "vitest";
import {
  basePriorityFor,
  effectiveScore,
  isPulseItemLive,
  rankPulseItems,
  type PulseItem
} from "@/lib/pulse/ranking";

const NOW = Date.parse("2026-07-16T12:00:00.000Z");

function item(overrides: Partial<PulseItem> = {}): PulseItem {
  return {
    id: "a",
    type: "wave",
    priority: basePriorityFor("wave"),
    createdAtMs: NOW,
    expiresAtMs: null,
    ...overrides
  };
}

describe("pulse base priority (spec §4)", () => {
  it("orders time-sensitive types above general activity", () => {
    expect(basePriorityFor("meeting_ping")).toBeGreaterThan(basePriorityFor("plan_invite"));
    expect(basePriorityFor("plan_invite")).toBeGreaterThan(basePriorityFor("wave"));
    expect(basePriorityFor("wave")).toBeGreaterThan(basePriorityFor("circle_activity"));
  });
});

describe("effectiveScore modifiers", () => {
  it("nudges very-close and close-friend within a band without leapfrogging urgency", () => {
    const veryCloseProximity = item({ type: "proximity", priority: basePriorityFor("proximity"), isVeryClose: true });
    const ping = item({ type: "meeting_ping", priority: basePriorityFor("meeting_ping") });
    expect(effectiveScore(ping)).toBeGreaterThan(effectiveScore(veryCloseProximity));
  });
});

describe("isPulseItemLive", () => {
  it("drops expired items", () => {
    expect(isPulseItemLive(item({ expiresAtMs: NOW - 1 }), NOW)).toBe(false);
    expect(isPulseItemLive(item({ expiresAtMs: NOW + 1000 }), NOW)).toBe(true);
    expect(isPulseItemLive(item({ expiresAtMs: null }), NOW)).toBe(true);
  });
});

describe("rankPulseItems (spec §14 stable ordering)", () => {
  it("sorts by score, removing expired, deterministic tie-break by id", () => {
    const ranked = rankPulseItems(
      [
        item({ id: "wave1", type: "wave", priority: basePriorityFor("wave") }),
        item({ id: "ping1", type: "meeting_ping", priority: basePriorityFor("meeting_ping") }),
        item({ id: "expired", type: "meeting_ping", priority: 200, expiresAtMs: NOW - 1 }),
        item({ id: "wave0", type: "wave", priority: basePriorityFor("wave") })
      ],
      NOW
    );
    expect(ranked.map((entry) => entry.id)).toEqual(["ping1", "wave0", "wave1"]);
  });
});
