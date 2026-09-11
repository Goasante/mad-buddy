import { describe, expect, it } from "vitest";

import {
  bandForDistance,
  PROXIMITY_BAND_LABELS,
  PROXIMITY_BAND_MAX_METERS,
  proximityBandLabel,
  proximityBandRangeLabel,
  resolveProximityBand,
  type ProximityBand
} from "@/lib/proximity/bands";
import { bucketProximity, FAR_MAX_METERS } from "@/lib/proximity/backend";

describe("band boundaries", () => {
  it.each([
    [0, "right_here"],
    [50, "right_here"],
    [100, "right_here"],
    [101, "around_you"],
    [500, "around_you"],
    [501, "close_by"],
    [2_000, "close_by"],
    [2_001, "nearby"],
    [5_000, "nearby"],
    [5_001, "around_town"],
    [10_000, "around_town"],
    [10_001, "further_away"],
    [15_000, "further_away"],
    [15_001, "outside_range"]
  ] as Array<[number, ProximityBand]>)("%dm resolves to %s", (metres, band) => {
    expect(resolveProximityBand(metres, "high")).toBe(band);
  });

  it("keeps boundaries contiguous and inclusive on the tighter side", () => {
    const pairs: Array<[number, ProximityBand, ProximityBand]> = [
      [PROXIMITY_BAND_MAX_METERS.right_here, "right_here", "around_you"],
      [PROXIMITY_BAND_MAX_METERS.around_you, "around_you", "close_by"],
      [PROXIMITY_BAND_MAX_METERS.close_by, "close_by", "nearby"],
      [PROXIMITY_BAND_MAX_METERS.nearby, "nearby", "around_town"],
      [PROXIMITY_BAND_MAX_METERS.around_town, "around_town", "further_away"]
    ];
    for (const [edge, inner, outer] of pairs) {
      expect(bandForDistance(edge)).toBe(inner);
      expect(bandForDistance(edge + 1)).toBe(outer);
    }
  });
});

describe("confidence never lets a reading overclaim", () => {
  it("lets normal indoor medium confidence claim Just Around when the measured band is 0-100m", () => {
    expect(resolveProximityBand(50, "high")).toBe("right_here");
    expect(resolveProximityBand(50, "medium")).toBe("right_here");
    expect(resolveProximityBand(50, "low")).toBe("close_by");
  });

  it("still widens genuinely low-confidence readings and never promotes beyond the measurement", () => {
    const order: ProximityBand[] = [
      "right_here",
      "around_you",
      "close_by",
      "nearby",
      "around_town",
      "further_away",
      "outside_range"
    ];
    for (const metres of [0, 100, 500, 2_000, 5_000, 8_000, 12_000]) {
      const high = resolveProximityBand(metres, "high");
      for (const confidence of ["medium", "low"] as const) {
        expect(order.indexOf(resolveProximityBand(metres, confidence))).toBeGreaterThanOrEqual(
          order.indexOf(high)
        );
      }
    }
  });

  it("treats omitted confidence as least certain", () => {
    expect(resolveProximityBand(50)).toBe(resolveProximityBand(50, "low"));
  });
});

describe("15 km eligibility gate", () => {
  it("stays identical to the backend exclusion boundary", () => {
    expect(PROXIMITY_BAND_MAX_METERS.further_away).toBe(FAR_MAX_METERS);
    expect(bucketProximity(FAR_MAX_METERS)).not.toBeNull();
    expect(bucketProximity(FAR_MAX_METERS + 1)).toBeNull();
    expect(resolveProximityBand(FAR_MAX_METERS, "high")).not.toBe("outside_range");
    expect(resolveProximityBand(FAR_MAX_METERS + 1, "high")).toBe("outside_range");
  });
});

describe("canonical qualitative labels", () => {
  it("uses the approved six-stage public vocabulary", () => {
    expect(proximityBandLabel("right_here")).toBe("Just Around");
    expect(proximityBandLabel("around_you")).toBe("Very Close");
    expect(proximityBandLabel("close_by")).toBe("Close");
    expect(proximityBandLabel("nearby")).toBe("In Area");
    expect(proximityBandLabel("around_town")).toBe("Nearby");
    expect(proximityBandLabel("further_away")).toBe("Far");
    expect(proximityBandLabel("outside_range")).toBeNull();
  });

  it("never turns a stored qualitative label into a numeric measurement", () => {
    for (const label of Object.values(PROXIMITY_BAND_LABELS)) {
      expect(label).not.toMatch(/\d/);
      expect(label.toLowerCase()).not.toMatch(/metre|meter|\bkm\b|mile|away in/);
    }
  });
});

describe("canonical secondary range labels", () => {
  it.each([
    ["right_here", "0–100 m"],
    ["around_you", "100–500 m"],
    ["close_by", "500 m–2 km"],
    ["nearby", "2–5 km"],
    ["around_town", "5–10 km"],
    ["further_away", "10–15 km"]
  ] as Array<[ProximityBand, string]>)("%s explains its public stage as %s", (band, copy) => {
    expect(proximityBandRangeLabel(band)).toBe(copy);
  });

  it("keeps Just Around anchored to the real <=100 m threshold", () => {
    expect(proximityBandRangeLabel("right_here")).toBe(
      `0–${PROXIMITY_BAND_MAX_METERS.right_here} m`
    );
  });

  it("keeps Nearby and Far as separate in-range categories", () => {
    expect(proximityBandRangeLabel("around_town")).toBe("5–10 km");
    expect(proximityBandRangeLabel("further_away")).toBe("10–15 km");
  });

  it("shows no public range beyond the 15 km eligibility gate", () => {
    expect(proximityBandRangeLabel("outside_range")).toBeNull();
    expect(bucketProximity(FAR_MAX_METERS + 1)).toBeNull();
  });
});

describe("unusable distances", () => {
  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, -5_000])(
    "%p cannot claim an in-range proximity state",
    (value) => {
      expect(resolveProximityBand(value as number, "high")).toBe("outside_range");
    }
  );
});
