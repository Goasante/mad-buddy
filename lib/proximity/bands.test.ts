import { describe, expect, it } from "vitest";
import {
  bandForDistance,
  PROXIMITY_BAND_LABELS,
  PROXIMITY_BAND_MAX_METERS,
  proximityBandLabel,
  resolveProximityBand,
  type ProximityBand
} from "@/lib/proximity/bands";
import { bucketProximity, FAR_MAX_METERS } from "@/lib/proximity/backend";

/**
 * The six proximity bands.
 *
 * Behavioural throughout: every case runs the real resolver against a real
 * distance. The point of the redesign is that proximity becomes MORE
 * informative without location becoming more precisely exposed, so these
 * assert both halves of that.
 */

// ---------------------------------------------------------------------------
// Boundaries: contiguous, inclusive-upper, no gaps
// ---------------------------------------------------------------------------

describe("band boundaries", () => {
  it.each([
    [0, "right_here"],
    [50, "right_here"],
    [100, "right_here"],
    [101, "around_you"],
    [499, "around_you"],
    [500, "around_you"],
    [501, "close_by"],
    [1_999, "close_by"],
    [2_000, "close_by"],
    [2_001, "nearby"],
    [4_999, "nearby"],
    [5_000, "nearby"],
    [5_001, "around_town"],
    [9_999, "around_town"],
    [10_000, "around_town"],
    [10_001, "further_away"],
    [14_999, "further_away"],
    [15_000, "further_away"],
    [15_001, "outside_range"]
  ] as Array<[number, ProximityBand]>)("%dm resolves to %s", (metres, band) => {
    // High confidence: the measured band, uncapped.
    expect(resolveProximityBand(metres, "high")).toBe(band);
  });

  it("leaves no distance unassigned", () => {
    // Every metre from 0 to just past the outer gate lands in exactly one
    // band -- a gap would mean a person with no label at all.
    for (let metres = 0; metres <= 15_100; metres += 7) {
      expect(bandForDistance(metres), `${metres}m`).toBeTruthy();
    }
  });

  it("never overlaps: each boundary belongs to the tighter band", () => {
    const pairs: Array<[number, ProximityBand, ProximityBand]> = [
      [PROXIMITY_BAND_MAX_METERS.right_here, "right_here", "around_you"],
      [PROXIMITY_BAND_MAX_METERS.around_you, "around_you", "close_by"],
      [PROXIMITY_BAND_MAX_METERS.close_by, "close_by", "nearby"],
      [PROXIMITY_BAND_MAX_METERS.nearby, "nearby", "around_town"],
      [PROXIMITY_BAND_MAX_METERS.around_town, "around_town", "further_away"]
    ];
    for (const [edge, inner, outer] of pairs) {
      expect(bandForDistance(edge), `${edge} inclusive`).toBe(inner);
      expect(bandForDistance(edge + 1), `${edge + 1} exclusive`).toBe(outer);
    }
  });
});

// ---------------------------------------------------------------------------
// Invalid input resolves outward, never inward
// ---------------------------------------------------------------------------

describe("unusable distances", () => {
  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, -5_000])(
    "%p cannot claim a precise band",
    (value) => {
      expect(resolveProximityBand(value as number, "high")).toBe("outside_range");
    }
  );

  it("treats an unknown confidence as the least certain", () => {
    // The default must be the cautious end. Defaulting to "high" would let a
    // caller that forgot the argument publish the tightest possible claim.
    expect(resolveProximityBand(50)).toBe(resolveProximityBand(50, "low"));
  });
});

// ---------------------------------------------------------------------------
// The precision gate: confidence caps how precise a CLAIM may be
// ---------------------------------------------------------------------------

describe("confidence never lets a reading overclaim", () => {
  it("only a high-confidence fix may say Right here", () => {
    expect(resolveProximityBand(50, "high")).toBe("right_here");
    expect(resolveProximityBand(50, "medium")).toBe("around_you");
    expect(resolveProximityBand(50, "low")).toBe("close_by");
  });

  it("widens outward and never inward", () => {
    // The cap may only ever move someone FURTHER away. A person genuinely
    // 8km off must not be pulled closer by a confidence value.
    for (const metres of [0, 100, 500, 2_000, 5_000, 8_000, 12_000]) {
      const high = resolveProximityBand(metres, "high");
      for (const confidence of ["medium", "low"] as const) {
        const capped = resolveProximityBand(metres, confidence);
        const order: ProximityBand[] = [
          "right_here",
          "around_you",
          "close_by",
          "nearby",
          "around_town",
          "further_away",
          "outside_range"
        ];
        expect(order.indexOf(capped), `${metres}m ${confidence}`).toBeGreaterThanOrEqual(
          order.indexOf(high)
        );
      }
    }
  });

  it("does not change coarse bands, which confidence already supports", () => {
    // A weak signal 8km away is still honestly "around town": the cap only
    // bites where the claim would be tighter than the reading justifies.
    for (const confidence of ["high", "medium", "low"] as const) {
      expect(resolveProximityBand(8_000, confidence)).toBe("around_town");
      expect(resolveProximityBand(12_000, confidence)).toBe("further_away");
    }
  });

  it("keeps a low-confidence reading out of the three tightest bands", () => {
    for (const metres of [0, 50, 100, 300, 500]) {
      expect(["close_by", "nearby", "around_town", "further_away"]).toContain(
        resolveProximityBand(metres, "low")
      );
    }
  });
});

// ---------------------------------------------------------------------------
// The 15km gate is unchanged
// ---------------------------------------------------------------------------

describe("the eligibility boundary is untouched", () => {
  it("agrees with the gate that actually excludes people", () => {
    // bucketProximity returning null is what drops someone from the response.
    // The presentation band must not disagree with it in either direction.
    expect(bucketProximity(FAR_MAX_METERS)).not.toBeNull();
    expect(bucketProximity(FAR_MAX_METERS + 1)).toBeNull();
    expect(resolveProximityBand(FAR_MAX_METERS, "high")).not.toBe("outside_range");
    expect(resolveProximityBand(FAR_MAX_METERS + 1, "high")).toBe("outside_range");
  });

  it("uses the same outer distance as the eligibility gate", () => {
    expect(PROXIMITY_BAND_MAX_METERS.further_away).toBe(FAR_MAX_METERS);
  });

  it("never admits anyone past the gate, at any confidence", () => {
    for (const confidence of ["high", "medium", "low"] as const) {
      expect(resolveProximityBand(15_001, confidence)).toBe("outside_range");
      expect(resolveProximityBand(50_000, confidence)).toBe("outside_range");
    }
  });
});

// ---------------------------------------------------------------------------
// Coarse labels only
// ---------------------------------------------------------------------------

describe("labels stay coarse", () => {
  it("renders no distance, unit or number", () => {
    for (const label of Object.values(PROXIMITY_BAND_LABELS)) {
      expect(label, label).not.toMatch(/\d/);
      expect(label.toLowerCase(), label).not.toMatch(/metre|meter|\bkm\b|mile|away in/);
    }
  });

  it("shows nothing at all for someone out of range", () => {
    // They are excluded upstream; this is the second line of defence.
    expect(proximityBandLabel("outside_range")).toBeNull();
  });

  it("reads in order, tightest to widest", () => {
    // Ids alone are not enough: swapping two labels would leave every
    // boundary test passing while the card told people the wrong thing.
    expect(proximityBandLabel("right_here")).toBe("Right here");
    expect(proximityBandLabel("around_you")).toBe("Around you");
    expect(proximityBandLabel("close_by")).toBe("Close by");
    expect(proximityBandLabel("nearby")).toBe("Nearby");
    expect(proximityBandLabel("around_town")).toBe("Around town");
    expect(proximityBandLabel("further_away")).toBe("Further away");
  });

  it("has copy for every band that can be rendered", () => {
    for (const band of [
      "right_here",
      "around_you",
      "close_by",
      "nearby",
      "around_town",
      "further_away"
    ] as ProximityBand[]) {
      expect(proximityBandLabel(band), band).toBeTruthy();
    }
  });
});
