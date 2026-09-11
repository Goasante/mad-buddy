import type { ConfidenceLevel } from "@/lib/proximity";

/**
 * The six privacy-safe presentation bands layered on top of the stored coarse
 * proximity enum. The server resolves these from measured distance; clients
 * receive only the band identifier, never coordinates or exact distance.
 */
export type ProximityBand =
  | "right_here"
  | "around_you"
  | "close_by"
  | "nearby"
  | "around_town"
  | "further_away"
  | "outside_range";

/** Canonical inclusive upper bound for every in-range band, in metres. */
export const PROXIMITY_BAND_MAX_METERS = {
  right_here: 100,
  around_you: 500,
  close_by: 2_000,
  nearby: 5_000,
  around_town: 10_000,
  further_away: 15_000
} as const;

export const PROXIMITY_BAND_LABELS: Record<ProximityBand, string> = {
  right_here: "Right Here",
  around_you: "Just Around",
  close_by: "Close By",
  nearby: "In Your Area",
  around_town: "Around Town",
  further_away: "Across Town",
  outside_range: "Too far"
};

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

const BAND_ORDER: readonly ProximityBand[] = [
  "right_here",
  "around_you",
  "close_by",
  "nearby",
  "around_town",
  "further_away",
  "outside_range"
];

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

/** The qualitative label a person reads, or null when there is no in-range state. */
export function proximityBandLabel(band: ProximityBand): string | null {
  return band === "outside_range" ? null : PROXIMITY_BAND_LABELS[band];
}

/**
 * Privacy-safe secondary range copy for the same band that drives the Glow.
 *
 * This deliberately renders the CANONICAL CEILING ("Within 500 m"), not a
 * lower-to-upper interval and never the measured distance. Confidence capping
 * and asymmetric band hysteresis are allowed to keep a person in a broader
 * band than their raw measurement. In that legitimate case, copy such as
 * "100-500 m" could be false while "Within 500 m" remains true. Reading the
 * ceiling from PROXIMITY_BAND_MAX_METERS also means label, range and Glow can
 * never drift onto separate threshold tables.
 */
export function proximityBandRangeLabel(band: ProximityBand): string | null {
  if (band === "outside_range") return null;
  return `Within ${formatBandCeiling(PROXIMITY_BAND_MAX_METERS[band])}`;
}

function formatBandCeiling(meters: number): string {
  if (meters < 1_000) return `${meters} m`;
  const kilometers = meters / 1_000;
  return `${Number.isInteger(kilometers) ? kilometers : kilometers.toFixed(1)} km`;
}
