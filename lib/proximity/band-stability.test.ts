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

describe("a stationary reading settles instead of flapping", () => {
  /**
   * The corrected model does not hold the ORIGINAL band through jitter -- that
   * would mean keeping a tighter label after the reading crossed outward. It
   * settles into the BROADER band and stays there: outward moves are believed
   * instantly, inward moves must clear the margin. Stable and conservative.
   */
  it("settles into the broader band and stops moving", () => {
    const jitter = [1_985, 2_012, 1_994, 2_030, 1_978, 2_020, 2_005, 1_990];

    let shown: ProximityBand = bandForDistance(jitter[0]);
    expect(shown).toBe("close_by");

    const sequence: ProximityBand[] = [];
    for (const reading of jitter) {
      shown = stabilizeDistance(reading, shown);
      sequence.push(shown);
    }

    // Exactly one transition: close_by holds while the reading is genuinely
    // inside it (1985), flips at the first outward reading (2012), and never
    // returns despite four later readings below 2000m.
    expect(sequence[0]).toBe("close_by");
    expect(shown).toBe("nearby");
    expect(sequence.slice(1).every((band) => band === "nearby")).toBe(true);

    // No flapping: the band changes at most once across the whole sequence.
    const changes = sequence.filter((band, i) => i > 0 && band !== sequence[i - 1]).length;
    expect(changes).toBe(1);
  });

  it("settles at the tightest boundary, where jitter matters most", () => {
    const jitter = [96, 104, 99, 108, 92, 101];
    let shown: ProximityBand = "right_here";
    for (const reading of jitter) shown = stabilizeDistance(reading, shown);
    // 104 pushes outward immediately; 99/92 are not far enough inside 100 to
    // earn the upgrade back (margin at the 100m boundary is 15m, so it takes
    // a reading below 85m).
    expect(shown).toBe("around_you");
  });

  it("settles at the widest boundary too", () => {
    const jitter = [9_960, 10_040, 9_980, 10_030];
    let shown: ProximityBand = "around_town";
    for (const reading of jitter) shown = stabilizeDistance(reading, shown);
    expect(shown).toBe("further_away");
  });

  it("never oscillates on the reported problem pattern", () => {
    // 1990 -> 2010 -> 1995 -> 2008, the exact sequence from the correction
    // brief. It must move outward once and stay there.
    const readings = [1_990, 2_010, 1_995, 2_008];
    let shown: ProximityBand = "close_by";
    const sequence: ProximityBand[] = [];
    for (const reading of readings) {
      shown = stabilizeDistance(reading, shown);
      sequence.push(shown);
    }

    expect(sequence).toEqual(["close_by", "nearby", "nearby", "nearby"]);
    // The specific failure being guarded: 1995 and 2008 must NOT restore the
    // closer label once the measurement has been outside it.
    expect(sequence.slice(2).every((band) => band === "nearby")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Direction is asymmetric: outward immediate, inward earned
// ---------------------------------------------------------------------------

describe("outward transitions are immediate at every boundary", () => {
  /**
   * The product rule: the UI must never retain a closer label once the accepted
   * measurement belongs to a broader band. One case per canonical boundary,
   * each one metre past it.
   */
  it.each([
    [101, "right_here", "around_you"],
    [501, "around_you", "close_by"],
    [2_001, "close_by", "nearby"],
    [5_001, "nearby", "around_town"],
    [10_001, "around_town", "further_away"]
  ] as const)("%dm leaves %s for %s with no delay", (meters, previous, expected) => {
    expect(stabilizeDistance(meters, previous)).toBe(expected);
  });

  it("never returns a band tighter than the raw measurement, anywhere", () => {
    // The invariant behind the rule, swept across the whole range against every
    // possible previous band: the shown band is never tighter than the reading.
    const ORDER: ProximityBand[] = [
      "right_here",
      "around_you",
      "close_by",
      "nearby",
      "around_town",
      "further_away",
      "outside_range"
    ];

    for (let meters = 0; meters <= 15_500; meters += 23) {
      const measured = bandForDistance(meters);
      for (const previous of ORDER) {
        const shown = stabilizeDistance(meters, previous);
        expect(
          ORDER.indexOf(shown),
          `${meters}m from ${previous} showed ${shown}, tighter than ${measured}`
        ).toBeGreaterThanOrEqual(ORDER.indexOf(measured));
      }
    }
  });
});

describe("inward transitions must clear the stability margin", () => {
  /**
   * Re-entry just inside a boundary does NOT upgrade. The margin is 8% of the
   * boundary, clamped to [15, 400]m -- so 100m -> 15m, 500m -> 40m,
   * 2000m -> 160m, 5000m -> 400m (clamped), 10000m -> 400m (clamped).
   */
  it.each([
    [99, "around_you", 100],
    [499, "close_by", 500],
    [1_990, "nearby", 2_000],
    [4_900, "around_town", 5_000],
    [9_800, "further_away", 10_000]
  ] as const)("%dm does not upgrade out of %s yet (boundary %d)", (meters, previous, boundary) => {
    expect(stabilizeDistance(meters, previous)).toBe(previous);
    // Sanity: the reading really is inside the tighter band, so the ONLY reason
    // it does not upgrade is the margin -- not that it was outside anyway.
    expect(meters).toBeLessThanOrEqual(boundary);
  });

  it.each([
    [80, "around_you", "right_here"],
    [440, "close_by", "around_you"],
    [1_800, "nearby", "close_by"],
    [4_500, "around_town", "nearby"],
    [9_500, "further_away", "around_town"]
  ] as const)("%dm does upgrade once clearly inside", (meters, previous, expected) => {
    expect(stabilizeDistance(meters, previous)).toBe(expected);
  });
});

describe("real movement still changes the band", () => {
  it("releases outward the moment the boundary is crossed", () => {
    // No margin in this direction: 2,001m is already enough, and so is 2,300m.
    expect(stabilizeDistance(2_001, "close_by")).toBe("nearby");
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
