import { describe, expect, it } from "vitest";
import { stabilizeBand, stabilizeDistance } from "@/lib/proximity/band-stability";
import { bandForDistance, resolveProximityBand, type ProximityBand } from "@/lib/proximity/bands";

/**
 * Band hysteresis.
 *
 * Behavioural: every case runs a real distance through the real resolver. The
 * property that matters is that a stationary phone with jittery GPS holds one
 * state, while a phone that actually moves changes state promptly -- and that
 * neither behaviour can make a claim the measurement does not support.
 */

describe("a stationary reading stops flapping", () => {
  it("holds one band while a reading jitters across a boundary", () => {
    // The failure without hysteresis: a phone sitting still at ~2km alternates
    // Close By / In Your Area on every refresh, and the redesign makes that
    // visible as a full change of layers, radius and pulse speed.
    const jitter = [1_985, 2_012, 1_994, 2_030, 1_978, 2_020, 2_005, 1_990];

    let shown: ProximityBand = bandForDistance(jitter[0]);
    const seen = new Set<ProximityBand>([shown]);
    for (const reading of jitter) {
      shown = stabilizeDistance(reading, shown);
      seen.add(shown);
    }

    expect(seen.size).toBe(1);
    expect(shown).toBe("close_by");
  });

  it("holds at the tightest boundary, where jitter matters most", () => {
    const jitter = [96, 104, 99, 108, 92, 101];
    let shown: ProximityBand = "right_here";
    for (const reading of jitter) shown = stabilizeDistance(reading, shown);
    expect(shown).toBe("right_here");
  });

  it("holds at the widest boundary too", () => {
    const jitter = [9_960, 10_040, 9_980, 10_030];
    let shown: ProximityBand = "around_town";
    for (const reading of jitter) shown = stabilizeDistance(reading, shown);
    expect(shown).toBe("around_town");
  });
});

describe("real movement still changes the band", () => {
  it("releases outward once the boundary is clearly cleared", () => {
    // 2,000m boundary, 8% margin = 160m. 2,300m is unambiguous.
    expect(stabilizeDistance(2_300, "close_by")).toBe("nearby");
  });

  it("releases inward once the boundary is clearly cleared", () => {
    expect(stabilizeDistance(1_700, "nearby")).toBe("close_by");
  });

  it("never damps a jump of more than one band", () => {
    // Someone who genuinely travelled must not lag behind their own movement.
    expect(stabilizeDistance(12_000, "right_here")).toBe("further_away");
    expect(stabilizeDistance(50, "further_away")).toBe("right_here");
  });

  it("tracks a continuous walk outward through every state", () => {
    let shown: ProximityBand | null = null;
    const seen: ProximityBand[] = [];
    for (let meters = 0; meters <= 15_000; meters += 50) {
      const next = stabilizeDistance(meters, shown);
      if (next !== shown) seen.push(next);
      shown = next;
    }
    expect(seen).toEqual([
      "right_here",
      "around_you",
      "close_by",
      "nearby",
      "around_town",
      "further_away"
    ]);
  });
});

describe("hysteresis never invents precision", () => {
  it("cannot tighten a band beyond what the reading says", () => {
    // Stickiness only DELAYS a transition. It can hold a wider band while a
    // reading tightens, never claim a tighter one than measured.
    for (let meters = 0; meters <= 15_000; meters += 37) {
      const measured = bandForDistance(meters);
      for (const previous of [
        "right_here",
        "around_you",
        "close_by",
        "nearby",
        "around_town",
        "further_away"
      ] as const) {
        const shown = stabilizeBand(measured, meters, previous);
        // The shown band is always either the measured one or the previous one
        // -- never a third, tighter state conjured out of the pair.
        expect([measured, previous]).toContain(shown);
      }
    }
  });

  it("preserves the confidence cap applied upstream", () => {
    // A low-confidence fix at 40m may only claim "close_by". Stabilising it
    // against a tighter previous band must not undo that cap.
    const capped = resolveProximityBand(40, "low");
    expect(capped).toBe("close_by");
    expect(stabilizeBand(capped, 40, "right_here")).not.toBe("right_here");
  });

  it("never re-admits someone past the eligibility gate", () => {
    // Crossing 15km is an eligibility question, not a presentation one, so it
    // is never damped in either direction.
    expect(stabilizeBand("outside_range", 15_400, "further_away")).toBe("outside_range");
    expect(stabilizeBand("further_away", 14_600, "outside_range")).toBe("further_away");
  });
});

describe("edge cases", () => {
  it("passes the measured band straight through with no history", () => {
    expect(stabilizeDistance(3_000, null)).toBe("nearby");
    expect(stabilizeDistance(3_000, undefined)).toBe("nearby");
  });

  it("does not stabilise an unusable reading into a confident band", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      expect(stabilizeDistance(bad, "right_here")).toBe("outside_range");
    }
  });

  it("is a no-op when the reading already agrees", () => {
    expect(stabilizeDistance(300, "around_you")).toBe("around_you");
  });
});
