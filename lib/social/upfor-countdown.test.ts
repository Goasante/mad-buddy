import { describe, expect, it } from "vitest";
import { UPFOR_COUNTDOWN_REFRESH_MS, upForCountdownLabel } from "@/lib/social/upfor-countdown";

const NOW = Date.parse("2026-07-17T14:00:00Z");
const at = (offsetMinutes: number) => new Date(NOW + offsetMinutes * 60_000).toISOString();
const row = (status: string, startMin: number, endMin: number) => ({
  status,
  startsAt: at(startMin),
  endsAt: at(endMin)
});

describe("a scheduled UpFor counts down to its start", () => {
  it("says how long until it begins", () => {
    expect(upForCountdownLabel(row("active", 47, 167), NOW)).toBe("Starts in 47m");
    expect(upForCountdownLabel(row("active", 120, 240), NOW)).toBe("Starts in 2h");
    expect(upForCountdownLabel(row("active", 143, 263), NOW)).toBe("Starts in 2h 23m");
  });

  it("says Now on the boundary rather than \"Starts in Now\"", () => {
    expect(upForCountdownLabel(row("active", 0.5, 120), NOW)).toBe("Now");
  });
});

describe("a live UpFor counts down to its end", () => {
  it("says how much time is left", () => {
    expect(upForCountdownLabel(row("active", -10, 42), NOW)).toBe("42m left");
    expect(upForCountdownLabel(row("active", -10, 84), NOW)).toBe("1h 24m left");
  });

  it("drops the minutes once past a whole hour", () => {
    // "2h" is easier to read than "2h 0m" and just as actionable.
    expect(upForCountdownLabel(row("active", -10, 120), NOW)).toBe("2h left");
  });

  it("says Now in the final minute instead of 0m left", () => {
    expect(upForCountdownLabel(row("active", -60, 0.5), NOW)).toBe("Now");
  });
});

describe("a finished UpFor shows no time at all", () => {
  it("shows nothing once the window has elapsed", () => {
    // THE STALE-TAB CASE. A tab asleep since before the end must not wake up
    // still showing a positive countdown; the label is derived, so it simply
    // stops existing.
    expect(upForCountdownLabel(row("active", -180, -60), NOW)).toBeNull();
  });

  it("shows nothing for cancelled, expired or converted, whatever the clock says", () => {
    for (const status of ["cancelled", "expired", "converted_to_plan"] as const) {
      // Deliberately given a window that has NOT elapsed: the lifecycle, not
      // the clock, is what makes these finished.
      expect(upForCountdownLabel(row(status, 30, 150), NOW), status).toBeNull();
    }
  });

  it("shows nothing for a draft", () => {
    expect(upForCountdownLabel(row("draft", 30, 150), NOW)).toBeNull();
  });

  it("shows nothing when the timestamps are unreadable", () => {
    expect(upForCountdownLabel({ status: "active", startsAt: "x", endsAt: "y" }, NOW)).toBeNull();
  });
});

describe("the countdown costs nothing to keep current", () => {
  it("refreshes about twice a minute, not every second", () => {
    // The smallest unit shown is a minute, so this is never more than half a
    // unit stale while costing two wakeups a minute rather than sixty.
    expect(UPFOR_COUNTDOWN_REFRESH_MS).toBe(30_000);
    expect(UPFOR_COUNTDOWN_REFRESH_MS).toBeGreaterThanOrEqual(30_000);
    expect(UPFOR_COUNTDOWN_REFRESH_MS).toBeLessThanOrEqual(60_000);
  });

  it("is a pure function of the row and the clock", () => {
    // No persistence, no fetch, no timer of its own: the same inputs always
    // give the same answer, which is what makes resume-from-background
    // correct for free.
    const r = row("active", 47, 167);
    expect(upForCountdownLabel(r, NOW)).toBe(upForCountdownLabel(r, NOW));
    // Advancing only the clock changes the label, with no state anywhere.
    expect(upForCountdownLabel(r, NOW + 40 * 60_000)).toBe("Starts in 7m");
  });
});
