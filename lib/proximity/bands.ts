import type { ConfidenceLevel } from "@/lib/proximity";

/**
 * Privacy-safe presentation bands layered on top of the stored coarse
 * proximity enum. The server resolves these from measured distance; clients
 * receive only the band identifier, never coordinates or exact distance.
 *
 * Public vocabulary is intentionally simpler than the internal thresholds:
 * the two broad 5–10 km and 10–15 km bands both read as "Nearby". That keeps
 * the product at six user-facing stages without changing backend eligibility.
 */
export type ProximityBand =
  | "right_here"
  | "around_you"
  | "close_by"
  | "nearby"
  | "around_town"
  | "further_away"
  | "outside_range";

type InRangeProximityBand = Exclude<ProximityBand, "outside_range">;

/** Canonical inclusive upper bound for every in-range band, in metres. */
export const PROXIMITY_BAND_MAX_METERS = {
  right_here: 100,
  around_you: 500,
  close_by: 2_000,
  nearby: 5_000,
  around_town: 10_000,
  further_away: 15_000
} as const;

/**
 * User-facing stage names, closest first:
 * Just Around → Very Close → Close → In Area → Nearby → Far.
 *
 * `Far` describes the outside-range category (15 km+). The Nearby discovery
 * endpoint still excludes candidates beyond 15 km; this label does not widen
 * that gate.
 */
export const PROXIMITY_BAND_LABELS: Record<ProximityBand, string> = {
  right_here: "Just Around",
  around_you: "Very Close",
  close_by: "Close",
  nearby: "In Area",
  around_town: "Nearby",
  further_away: "Nearby",
  outside_range: "Far"
};

/** Ordered once so resolution and display ranges cannot drift apart. */
const IN_RANGE_BANDS: readonly InRangeProximityBand[] = [
  "right_here",
  "around_you",
  "close_by",
  "nearby",
  "around_town",
  "further_away"
];

/**
 * The tightest claim a reading of each confidence may make. This is a privacy
 * guard, not a visual preference: weak readings are widened outward rather than
 * allowed to look more precise than the location fix supports.
 */
const FINEST_BAND_BY_CONFIDENCE: Record<ConfidenceLevel, ProximityBand> = {
  high: "right_here",
  medium: "around_you",
  low: "close_by"
};

const BAND_ORDER: readonly ProximityBand[] = [...IN_RANGE_BANDS, "outside_range"];

export function bandForDistance(distanceMeters: number): ProximityBand {
  if (!Number.isFinite(distanceMeters) || distanceMeters < 0) return "outside_range";

  if (distanceMeters <= PROXIMITY_BAND_MAX_METERS.right_here) return "right_here";
  if (distanceMeters <= PROXIMITY_BAND_MAX_METERS.around_you) return "around_you";
  if (distanceMeters <= PROXIMITY_BAND_MAX_METERS.close_by) return "close_by";
  if (distanceMeters <= PROXIMITY_BAND_MAX_METERS.nearby) return "nearby";
  if (distanceMeters <= PROXIMITY_BAND_MAX_METERS.around_town) return "around_town";
  if (distanceMeters <= PROXIMITY_BAND_MAX_METERS.further_away) return "further_away";
  return "outside_range";
}

export function resolveProximityBand(
  distanceMeters: number,
  confidence: ConfidenceLevel = "low"
): ProximityBand {
  const measured = bandForDistance(distanceMeters);
  if (measured === "outside_range") return "outside_range";

  const finest = FINEST_BAND_BY_CONFIDENCE[confidence];
  return BAND_ORDER.indexOf(measured) < BAND_ORDER.indexOf(finest) ? finest : measured;
}

/** Qualitative label only; never an exact measured distance. */
export function proximityBandLabel(band: ProximityBand): string {
  return PROXIMITY_BAND_LABELS[band];
}

/**
 * Secondary copy explaining the stage vocabulary. This is not the measured
 * distance. Both the label and range are derived from the already-resolved band.
 *
 * Two internal broad bands intentionally collapse to the same public Nearby
 * stage and therefore the same explanatory range: 5–15 km.
 */
export function proximityBandRangeLabel(band: ProximityBand): string {
  if (band === "outside_range") return "15 km+";
  if (band === "around_town" || band === "further_away") return "5–15 km";

  const index = IN_RANGE_BANDS.indexOf(band);
  const previousBand = index > 0 ? IN_RANGE_BANDS[index - 1] : null;
  const minMeters = previousBand ? PROXIMITY_BAND_MAX_METERS[previousBand] : 0;
  const maxMeters = PROXIMITY_BAND_MAX_METERS[band];

  return formatBandRange(minMeters, maxMeters);
}

function formatBandRange(minMeters: number, maxMeters: number): string {
  const minUsesKilometers = minMeters >= 1_000;
  const maxUsesKilometers = maxMeters >= 1_000;

  if (minUsesKilometers === maxUsesKilometers) {
    const unit = maxUsesKilometers ? "km" : "m";
    return `${formatBandMagnitude(minMeters, unit)}–${formatBandMagnitude(maxMeters, unit)} ${unit}`;
  }

  return `${formatBandDistance(minMeters)}–${formatBandDistance(maxMeters)}`;
}

function formatBandMagnitude(meters: number, unit: "m" | "km"): string {
  if (unit === "m") return String(meters);
  const kilometers = meters / 1_000;
  return Number.isInteger(kilometers) ? String(kilometers) : kilometers.toFixed(1);
}

function formatBandDistance(meters: number): string {
  const unit = meters < 1_000 ? "m" : "km";
  return `${formatBandMagnitude(meters, unit)} ${unit}`;
}
