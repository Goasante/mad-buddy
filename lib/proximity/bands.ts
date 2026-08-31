import type { ConfidenceLevel } from "@/lib/proximity";

/**
 * The six proximity bands a person actually reads.
 *
 * WHY THIS IS SEPARATE FROM ProximityLevel. `ProximityLevel`
 * ("close" | "near" | "far" | "hidden") is a stored database enum, pinned to
 * the generated types by lib/proximity/parity.test.ts. These bands are a
 * PRESENTATION refinement on top of the same measured distance -- they make
 * the existing 0-15km range more informative without changing what is stored,
 * transmitted, or authorized.
 *
 * NOTHING HERE WIDENS ACCESS. The 15km eligibility gate lives in
 * bucketProximity(), which returns null past FAR_MAX_METERS and causes the
 * person to be dropped from the response entirely. `outside_range` here is
 * the same boundary restated for presentation; it never re-admits anyone.
 *
 * NOTHING HERE EXPOSES DISTANCE. Callers pass metres that were computed
 * server-side and receive a band identifier. The measured distance is never
 * part of a response -- assertPrivacySafeResponse rejects any payload
 * containing distance/meters/coord/accuracy keys.
 */

export type ProximityBand =
  | "right_here"
  | "around_you"
  | "close_by"
  | "nearby"
  | "around_town"
  | "further_away"
  | "outside_range";

/**
 * Upper bound of each band, in metres, inclusive.
 *
 * One canonical table. Components must never re-derive these: a second copy
 * of "100" somewhere in a card is how two surfaces start disagreeing about
 * what "Right here" means.
 */
export const PROXIMITY_BAND_MAX_METERS = {
  right_here: 100,
  around_you: 500,
  close_by: 2_000,
  nearby: 5_000,
  around_town: 10_000,
  further_away: 15_000
} as const;

/**
 * User-facing copy. Stable ids above, wording here.
 *
 * These are the approved Proximity Glow V2 names. They are Title Case because
 * they read as named states rather than as descriptions -- a person is IN
 * "Close By", they are not "close by" in the adjectival sense. The same six
 * strings appear in lib/proximity/glow-config.ts, which is the presentation
 * authority; a mismatch between the two is a bug, and
 * lib/proximity/glow-config.test.ts asserts they agree.
 */
export const PROXIMITY_BAND_LABELS: Record<ProximityBand, string> = {
  right_here: "Right Here",
  around_you: "Just Around",
  close_by: "Close By",
  nearby: "In Your Area",
  around_town: "Around Town",
  further_away: "Across Town",
  // Never rendered: someone outside range is excluded from the response
  // before any label is chosen. Present so the type is total.
  outside_range: "Too far"
};

/**
 * The tightest band a reading of each confidence may claim.
 *
 * THE PRECISION GATE. The existing model already pads a distance outward by
 * its uncertainty before bucketing (see confidenceUncertaintyMeters in
 * backend.ts) -- a soft reading resolves further away, never closer. That
 * padding is preserved exactly and is NOT rescaled.
 *
 * But padding alone was calibrated for 5km-wide bands. With a 100m band, a
 * medium reading whose true error is ±200m could still land in "Right here"
 * by luck of rounding. So confidence additionally caps how precise a CLAIM
 * may be: only a high-confidence fix may say "Right here", because only a
 * high-confidence fix knows it.
 *
 * This never moves anyone closer -- it can only widen the band outward.
 */
const FINEST_BAND_BY_CONFIDENCE: Record<ConfidenceLevel, ProximityBand> = {
  high: "right_here",
  // A soft signal can honestly say "around you", not "right here".
  medium: "around_you",
  // A weak one commits to nothing tighter than a neighbourhood.
  low: "close_by"
};

/** Bands from tightest to widest, so a cap can be applied by position. */
const BAND_ORDER: readonly ProximityBand[] = [
  "right_here",
  "around_you",
  "close_by",
  "nearby",
  "around_town",
  "further_away",
  "outside_range"
];

/**
 * Which band a measured distance falls in, before any confidence cap.
 *
 * Boundaries are inclusive-upper and contiguous: every non-negative distance
 * maps to exactly one band, with no gap and no overlap. 100 is "right here";
 * 100.01 is "around you".
 */
export function bandForDistance(distanceMeters: number): ProximityBand {
  // A distance that is not a usable number cannot support any claim about
  // where someone is, so it resolves to the outermost result rather than
  // defaulting into a precise one.
  if (!Number.isFinite(distanceMeters) || distanceMeters < 0) return "outside_range";

  if (distanceMeters <= PROXIMITY_BAND_MAX_METERS.right_here) return "right_here";
  if (distanceMeters <= PROXIMITY_BAND_MAX_METERS.around_you) return "around_you";
  if (distanceMeters <= PROXIMITY_BAND_MAX_METERS.close_by) return "close_by";
  if (distanceMeters <= PROXIMITY_BAND_MAX_METERS.nearby) return "nearby";
  if (distanceMeters <= PROXIMITY_BAND_MAX_METERS.around_town) return "around_town";
  if (distanceMeters <= PROXIMITY_BAND_MAX_METERS.further_away) return "further_away";
  return "outside_range";
}

/**
 * The canonical resolver. Everything user-facing goes through this.
 *
 * @param distanceMeters server-computed metres. Never sent to a client.
 * @param confidence the weaker of the two readings, as the backend already
 *   computes it. Omitted only where no confidence is known, which is treated
 *   as the least certain case rather than the most.
 */
export function resolveProximityBand(
  distanceMeters: number,
  confidence: ConfidenceLevel = "low"
): ProximityBand {
  const measured = bandForDistance(distanceMeters);
  if (measured === "outside_range") return "outside_range";

  const finest = FINEST_BAND_BY_CONFIDENCE[confidence];
  // Widen to the finest band this confidence may claim, never narrow.
  return BAND_ORDER.indexOf(measured) < BAND_ORDER.indexOf(finest) ? finest : measured;
}

/** The label a person reads, or null when there is nothing to show. */
export function proximityBandLabel(band: ProximityBand): string | null {
  return band === "outside_range" ? null : PROXIMITY_BAND_LABELS[band];
}
