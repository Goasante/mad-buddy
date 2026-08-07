/**
 * Approximate distance — the ONE place a real distance becomes a display value.
 *
 * Owner decision (Socialize 2.0): people may see roughly how far away someone
 * is, not just "Nearby". That is a deliberate change to the product's privacy
 * philosophy, and this module is the whole of it — every surface that shows a
 * distance calls this, so the rounding rule can never differ between screens.
 *
 * WHAT THIS PROTECTS AGAINST
 *
 * A precise distance is not a location, but three of them are. Given exact
 * distances from three known points, anyone can trilaterate a person's
 * position to within metres. Two things here make that useless:
 *
 *  1. AGGRESSIVE, WIDENING BUCKETS. The output is a bucket, not a measurement.
 *    Under 1 km everything reads "under 1 km"; past that the buckets widen
 *    with distance, so the absolute error grows as the number does.
 *
 *  2. STABLE EDGES. Buckets snap to fixed boundaries rather than rounding a
 *    live value, so someone walking across a room cannot be watched drifting
 *    from "≈2 km" to "≈2.1 km". A displayed number changes only when a real
 *    boundary is crossed, which takes hundreds of metres.
 *
 * The confidence padding the proximity engine already applies is added BEFORE
 * bucketing, so a low-confidence fix reads as further away rather than being
 * reported with false precision.
 *
 * Coordinates never appear in this module's input or output. It takes metres
 * and returns a string.
 */

import type { ConfidenceLevel } from "@/lib/proximity";

/**
 * Below this, no number is shown at all.
 *
 * Sub-kilometre precision is where trilateration becomes genuinely dangerous
 * — it is the difference between "in this city" and "in this building" — so
 * the closest bucket is deliberately the vaguest.
 */
const NEARBY_FLOOR_METERS = 1_000;

/**
 * Bucket width by distance band, in metres.
 *
 * Widening on purpose: a 500 m bucket at 2 km is a tighter relative fix than a
 * 500 m bucket at 12 km, so the width grows with the value it describes.
 */
function bucketWidthMeters(distanceMeters: number): number {
  if (distanceMeters < 5_000) return 1_000;
  if (distanceMeters < 10_000) return 2_000;
  return 5_000;
}

/**
 * Same uncertainty padding the proximity tiering uses.
 *
 * Duplicated as a local constant rather than imported because
 * `lib/proximity/backend.ts` is a server module; this one is shared with the
 * client, and importing it would drag the whole backend into the bundle.
 * Kept in step by a test that asserts the two agree.
 */
export const DISTANCE_UNCERTAINTY_METERS: Record<ConfidenceLevel, number> = {
  high: 0,
  medium: 200,
  low: 2_000
};

/**
 * A rounded, display-ready distance, or null when it should not be shown.
 *
 * Null means "show nothing" rather than "show zero": a person whose location
 * is unknown, stale, or out of range has no distance, and inventing one would
 * be worse than omitting the line.
 */
export function approximateDistanceLabel(
  distanceMeters: number | null | undefined,
  confidence: ConfidenceLevel = "low"
): string | null {
  if (distanceMeters === null || distanceMeters === undefined) return null;
  if (!Number.isFinite(distanceMeters) || distanceMeters < 0) return null;

  // Pad by the same uncertainty the tiering uses, so an imprecise fix reads
  // as further rather than as confidently close.
  const padded = distanceMeters + DISTANCE_UNCERTAINTY_METERS[confidence];

  // The closest band carries no number at all.
  if (padded < NEARBY_FLOOR_METERS) return "Under 1 km away";

  const width = bucketWidthMeters(padded);
  // Snap DOWN to a fixed edge. Down rather than nearest, so the label never
  // overstates closeness — and fixed edges mean small real movements do not
  // move the number.
  const snappedMeters = Math.floor(padded / width) * width;
  const kilometres = Math.max(1, Math.round(snappedMeters / 1_000));

  return `≈ ${kilometres} km away`;
}

/**
 * Whether two distances would render identically.
 *
 * Used by tests to prove the bucketing is coarse enough that ordinary movement
 * does not change the display — the property that makes repeated reads useless
 * for tracking.
 */
export function rendersIdentically(
  metersA: number,
  metersB: number,
  confidence: ConfidenceLevel = "high"
): boolean {
  return approximateDistanceLabel(metersA, confidence) === approximateDistanceLabel(metersB, confidence);
}
