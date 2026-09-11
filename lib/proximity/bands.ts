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
 * Canonical public vocabulary, closest first:
 * Just Around → Very Close → Close → In Area → Nearby → Far.
 *
 * All six public states are inside the existing 15 km eligibility boundary.
 * Anything beyond 15 km is outside range and must not be presented as Far.
 */
export const PROXIMITY_BAND_LABELS: Record<ProximityBand, string> = {
  right_here: "Just Around",
  around_you: "Very Close",
  close_by: "Close",
  nearby: "In Area",
  around_town: "Nearby",
  further_away: "Far",
  outside_range: "Too far"
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

/** The qualitative label a person reads, or null when there is no in-range state. */
export function proximityBandLabel(band: ProximityBand): string | null {
  return band === "outside_range" ? null : PROXIMITY_BAND_LABELS[band];
}

/**
 * Secondary copy explaining what a proximity term means, not where somebody
 * exactly is. The UI receives only the already-resolved band, so this never
 * exposes the measured distance or coordinates.
 *
 * Both ends are derived from the SAME canonical ceiling table used by the band
 * resolver. If a boundary changes, the displayed category range changes with
 * it rather than leaving stale copy in a component.
 */
export function proximityBandRangeLabel(band: ProximityBand): string | null {
  if (band === "outside_range") return null;

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
