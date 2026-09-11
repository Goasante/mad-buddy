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
  it("only high confidence may claim Right Here", () => {
    expect(resolveProximityBand(50, "high")).toBe("right_here");
    expect(resolveProximityBand(50, "medium")).toBe("around_you");
    expect(resolveProximityBand(50, "low")).toBe("close_by");
  });

  it("widens outward and never inward", () => {
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
  it("keeps the approved six names", () => {
    expect(proximityBandLabel("right_here")).toBe("Right Here");
    expect(proximityBandLabel("around_you")).toBe("Just Around");
    expect(proximityBandLabel("close_by")).toBe("Close By");
    expect(proximityBandLabel("nearby")).toBe("In Your Area");
    expect(proximityBandLabel("around_town")).toBe("Around Town");
    expect(proximityBandLabel("further_away")).toBe("Across Town");
    expect(proximityBandLabel("outside_range")).toBeNull();
  });

  it("never turns the primary label into a numeric measurement", () => {
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
  ] as Array<[ProximityBand, string]>)("%s explains its configured band as %s", (band, copy) => {
    expect(proximityBandRangeLabel(band)).toBe(copy);
  });

  it("shows no range outside the eligibility gate", () => {
    expect(proximityBandRangeLabel("outside_range")).toBeNull();
  });

  it("reads both ends from the same threshold authority", () => {
    expect(proximityBandRangeLabel("right_here")).toBe(
      `0–${PROXIMITY_BAND_MAX_METERS.right_here} m`
    );
    expect(proximityBandRangeLabel("around_you")).toBe(
      `${PROXIMITY_BAND_MAX_METERS.right_here}–${PROXIMITY_BAND_MAX_METERS.around_you} m`
    );
    expect(proximityBandRangeLabel("further_away")).toBe(
      `${PROXIMITY_BAND_MAX_METERS.around_town / 1_000}–${PROXIMITY_BAND_MAX_METERS.further_away / 1_000} km`
    );
  });

  it("never suggests somebody can be shown past 15 km", () => {
    expect(proximityBandRangeLabel("further_away")).toBe("10–15 km");
    expect(proximityBandRangeLabel("further_away")).not.toContain("+");
  });
});

describe("unusable distances", () => {
  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, -5_000])(
    "%p cannot claim a proximity state",
    (value) => {
      expect(resolveProximityBand(value as number, "high")).toBe("outside_range");
    }
  );
});
