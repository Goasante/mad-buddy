import { describe, expect, it } from "vitest";
import {
  consumesUpForSlot,
  isComingUpUpFor,
  isDiscoverableUpFor,
  isOwnerVisibleUpFor,
  upForPhase
} from "@/lib/social/upfor-lifecycle";

const NOW = Date.parse("2026-07-17T14:00:00Z");
const row = (status: string, startsAt: string, endsAt: string) => ({ status, startsAt, endsAt });

/** Every status the CHECK constraint permits, so none can be silently forgotten. */
const ALL_STATUSES = [
  "draft",
  "active",
  "paused",
  "full",
  "expired",
  "cancelled",
  "converted_to_plan"
] as const;

describe("what consumes one of the three concurrent slots", () => {
  const future = row("active", "2026-07-17T18:00:00Z", "2026-07-17T20:00:00Z");
  const current = row("active", "2026-07-17T13:00:00Z", "2026-07-17T16:00:00Z");

  it("counts a scheduled UpFor: a commitment already made", () => {
    expect(consumesUpForSlot(future, NOW)).toBe(true);
    expect(upForPhase(future, NOW)).toBe("scheduled");
  });

  it("counts a running UpFor", () => {
    expect(consumesUpForSlot(current, NOW)).toBe(true);
    expect(upForPhase(current, NOW)).toBe("live");
  });

  it("counts paused and full, because neither is terminal", () => {
    // The reason this matters: if pausing freed a slot, somebody could hold
    // unlimited sessions by pausing each one in turn.
    for (const status of ["paused", "full"] as const) {
      expect(consumesUpForSlot(row(status, "2026-07-17T13:00:00Z", "2026-07-17T16:00:00Z"), NOW), status).toBe(true);
    }
  });

  it("does not count any terminal status", () => {
    for (const status of ["expired", "cancelled", "converted_to_plan"] as const) {
      // Even with a window that has not elapsed: the lifecycle, not the clock,
      // is what makes these finished.
      expect(consumesUpForSlot(row(status, "2026-07-17T13:00:00Z", "2026-07-17T20:00:00Z"), NOW), status).toBe(false);
    }
  });

  it("does not count a draft, which was never published", () => {
    expect(consumesUpForSlot(row("draft", "2026-07-17T18:00:00Z", "2026-07-17T20:00:00Z"), NOW)).toBe(false);
  });

  it("does not count a live-status row whose window has elapsed", () => {
    // The sweep flips these to `expired`, but the count must be correct even
    // in the window before it runs.
    expect(consumesUpForSlot(row("active", "2026-07-17T09:00:00Z", "2026-07-17T11:00:00Z"), NOW)).toBe(false);
  });

  it("classifies every status the constraint allows", () => {
    // Guards against a new status being added to the CHECK constraint without
    // a deliberate decision about whether it spends a slot.
    const classified = ALL_STATUSES.map((status) => ({
      status,
      counts: consumesUpForSlot(row(status, "2026-07-17T13:00:00Z", "2026-07-17T20:00:00Z"), NOW)
    }));
    expect(classified).toEqual([
      { status: "draft", counts: false },
      { status: "active", counts: true },
      { status: "paused", counts: true },
      { status: "full", counts: true },
      { status: "expired", counts: false },
      { status: "cancelled", counts: false },
      { status: "converted_to_plan", counts: false }
    ]);
  });
});

describe("discovery must not publish a scheduled UpFor early", () => {
  it("hides an UpFor that has not started", () => {
    // Created at 14:00 for 18:00: broadcasting it now would tell everyone four
    // hours before the owner meant to be visible.
    expect(isDiscoverableUpFor(row("active", "2026-07-17T18:00:00Z", "2026-07-17T20:00:00Z"), NOW)).toBe(false);
  });

  it("shows it once it starts", () => {
    expect(isDiscoverableUpFor(row("active", "2026-07-17T13:00:00Z", "2026-07-17T16:00:00Z"), NOW)).toBe(true);
  });

  it("never publishes paused, full or terminal rows", () => {
    for (const status of ["paused", "full", "expired", "cancelled", "converted_to_plan", "draft"] as const) {
      expect(isDiscoverableUpFor(row(status, "2026-07-17T13:00:00Z", "2026-07-17T16:00:00Z"), NOW), status).toBe(false);
    }
  });
});

describe("Coming Up wants exactly the scheduled ones", () => {
  it("includes a not-yet-started UpFor", () => {
    expect(isComingUpUpFor(row("active", "2026-07-17T18:00:00Z", "2026-07-17T20:00:00Z"), NOW)).toBe(true);
  });

  it("excludes one already running", () => {
    expect(isComingUpUpFor(row("active", "2026-07-17T13:00:00Z", "2026-07-17T16:00:00Z"), NOW)).toBe(false);
  });

  it("excludes terminal rows, including a converted one", () => {
    // The converted intent is a Plan now. Showing both would double-count it.
    for (const status of ["expired", "cancelled", "converted_to_plan"] as const) {
      expect(isComingUpUpFor(row(status, "2026-07-17T18:00:00Z", "2026-07-17T20:00:00Z"), NOW), status).toBe(false);
    }
  });
});

describe("the owner can always see what they scheduled", () => {
  it("shows a scheduled UpFor to its owner before it starts", () => {
    expect(isOwnerVisibleUpFor(row("active", "2026-07-17T18:00:00Z", "2026-07-17T20:00:00Z"), NOW)).toBe(true);
  });

  it("stops showing it once terminal", () => {
    expect(isOwnerVisibleUpFor(row("cancelled", "2026-07-17T18:00:00Z", "2026-07-17T20:00:00Z"), NOW)).toBe(false);
  });
});

describe("legacy and malformed rows degrade safely", () => {
  it("treats an unreadable timestamp as terminal rather than publishing it", () => {
    const broken = row("active", "not-a-date", "also-not-a-date");
    expect(upForPhase(broken, NOW)).toBe("terminal");
    expect(isDiscoverableUpFor(broken, NOW)).toBe(false);
    expect(consumesUpForSlot(broken, NOW)).toBe(false);
  });

  it("does not make an old immediate UpFor look scheduled", () => {
    // Every pre-existing row has starts_at <= created_at, so none of them can
    // suddenly appear in Coming Up after the migration.
    const legacy = row("active", "2026-07-17T09:00:00Z", "2026-07-17T16:00:00Z");
    expect(upForPhase(legacy, NOW)).toBe("live");
    expect(isComingUpUpFor(legacy, NOW)).toBe(false);
  });
});

describe("slot accounting and Coming Up are different questions", () => {
  const NOW_MS = NOW;
  const future = (status: string) => row(status, "2026-07-17T18:00:00Z", "2026-07-17T20:00:00Z");

  it("counts paused and full toward the ceiling but keeps them OUT of Coming Up", () => {
    /*
     * THE DELIBERATE DISAGREEMENT.
     *
     * A paused or full UpFor is a live intent the owner still holds, so it
     * spends a slot -- otherwise pausing would be a way to hold unlimited
     * sessions. But neither is something the viewer is waiting for: paused is
     * not accepting anyone, and full has no room. Home lists what is coming
     * up, not what is merely occupying a slot.
     *
     * These two predicates must therefore be allowed to differ, which is why
     * Home must never be built on consumesUpForSlot().
     */
    for (const status of ["paused", "full"] as const) {
      expect(consumesUpForSlot(future(status), NOW_MS), `${status} spends a slot`).toBe(true);
      expect(isComingUpUpFor(future(status), NOW_MS), `${status} is not Coming Up`).toBe(false);
    }
  });

  it("agrees on a future active UpFor: it both spends a slot and is coming up", () => {
    expect(consumesUpForSlot(future("active"), NOW_MS)).toBe(true);
    expect(isComingUpUpFor(future("active"), NOW_MS)).toBe(true);
  });

  it("agrees that terminal rows do neither", () => {
    for (const status of ["expired", "cancelled", "converted_to_plan"] as const) {
      expect(consumesUpForSlot(future(status), NOW_MS), status).toBe(false);
      expect(isComingUpUpFor(future(status), NOW_MS), status).toBe(false);
    }
  });

  it("disagrees on a RUNNING UpFor: it spends a slot but is not coming up", () => {
    // Already happening, so it is not something to look forward to.
    const running = row("active", "2026-07-17T13:00:00Z", "2026-07-17T16:00:00Z");
    expect(consumesUpForSlot(running, NOW_MS)).toBe(true);
    expect(isComingUpUpFor(running, NOW_MS)).toBe(false);
  });
});
