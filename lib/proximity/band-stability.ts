import type { ProximityBand } from "@/lib/proximity/bands";
import { bandForDistance, PROXIMITY_BAND_MAX_METERS } from "@/lib/proximity/bands";

/**
 * Band hysteresis: stops the Glow flapping at a boundary.
 *
 * THE PROBLEM. Bands are contiguous and inclusive-upper, so a reading that
 * jitters around 2,000m -- which GPS does constantly, even for a stationary
 * phone -- alternates `close_by` / `nearby` / `close_by` on every refresh. At
 * the old 5km-wide buckets that was rare. At a 100m band it is the normal case,
 * and the redesign makes it visible: the Glow would visibly change energy,
 * layer count and pulse speed every few seconds while nobody moved.
 *
 * THE FIX. A band, once shown, is sticky. Leaving it requires clearing its
 * boundary by a margin; re-entering it does not. This is the standard
 * Schmitt-trigger shape, and it is applied to the ALREADY-BUCKETED
 * presentation band rather than to the distance, so it cannot alter the 15km
 * eligibility gate or any authorization decision.
 *
 * WHY THIS IS NOT FAKE PRECISION. Hysteresis never claims a tighter band than
 * the measurement supports: it only delays a transition that the raw reading
 * has already made, in whichever direction. It cannot move someone from
 * `nearby` into `right_here`; it can only keep them in the band they were
 * already being shown in until the evidence is unambiguous.
 *
 * WHY IT IS PRIVACY-SAFE. It takes metres that were computed server-side and
 * returns a band identifier, exactly as resolveProximityBand does. The previous
 * band is a band identifier too. Nothing here is sent to a client, and nothing
 * here narrows a band below what confidence already permitted.
 */

/**
 * How far past a boundary a reading must travel to leave a band.
 *
 * Proportional, not fixed: 40m of jitter is decisive at the 100m boundary and
 * meaningless at the 10km one, so a single absolute margin would either fail to
 * damp the wide bands or freeze the tight ones. 8% of the boundary keeps the
 * damping proportionate to the scale being measured.
 *
 * Clamped at both ends so the margin stays sane: never so small it does not
 * damp anything, never so large it swallows a whole band. The tightest band is
 * 100m wide, so the floor must stay well under that.
 */
const BOUNDARY_MARGIN_RATIO = 0.08;
const MIN_BOUNDARY_MARGIN_METERS = 15;
const MAX_BOUNDARY_MARGIN_METERS = 400;

/** Bands ordered tightest to widest. Position is the comparison key. */
const BAND_ORDER: readonly ProximityBand[] = [
  "right_here",
  "around_you",
  "close_by",
  "nearby",
  "around_town",
  "further_away",
  "outside_range"
];

function marginFor(boundaryMeters: number): number {
  return Math.min(
    MAX_BOUNDARY_MARGIN_METERS,
    Math.max(MIN_BOUNDARY_MARGIN_METERS, boundaryMeters * BOUNDARY_MARGIN_RATIO)
  );
}

/** The upper bound of a band in metres, or null for the terminal band. */
function upperBoundOf(band: ProximityBand): number | null {
  if (band === "outside_range") return null;
  return PROXIMITY_BAND_MAX_METERS[band];
}

/**
 * Apply hysteresis to a freshly measured band.
 *
 * @param measuredBand the band the current reading resolves to, already capped
 *   by confidence via resolveProximityBand. Passed in rather than recomputed so
 *   the confidence cap is applied exactly once, upstream.
 * @param distanceMeters the same server-computed metres that produced it.
 * @param previousBand the band this pair was last shown in, if any.
 * @returns the band to display.
 */
export function stabilizeBand(
  measuredBand: ProximityBand,
  distanceMeters: number,
  previousBand: ProximityBand | null | undefined
): ProximityBand {
  // No history, or an unusable reading: nothing to stabilise against.
  if (!previousBand || !Number.isFinite(distanceMeters) || distanceMeters < 0) {
    return measuredBand;
  }

  // Already agreed: the common case, and no decision to make.
  if (measuredBand === previousBand) return previousBand;

  const previousIndex = BAND_ORDER.indexOf(previousBand);
  const measuredIndex = BAND_ORDER.indexOf(measuredBand);
  if (previousIndex < 0 || measuredIndex < 0) return measuredBand;

  // Crossing the eligibility gate is never damped in either direction: whether
  // someone is inside the 15km range is an eligibility question, and stickiness
  // must not keep showing a Glow for somebody who has left it.
  if (measuredBand === "outside_range" || previousBand === "outside_range") {
    return measuredBand;
  }

  // A jump of more than one band is real movement, not jitter, so it is never
  // damped -- damping it would visibly lag someone who actually travelled.
  if (Math.abs(measuredIndex - previousIndex) > 1) return measuredBand;

  if (measuredIndex > previousIndex) {
    // Moving OUTWARD. The boundary being crossed is the top of the previous
    // (tighter) band. Require clearing it by the margin.
    const boundary = upperBoundOf(previousBand);
    if (boundary === null) return measuredBand;
    return distanceMeters > boundary + marginFor(boundary) ? measuredBand : previousBand;
  }

  // Moving INWARD. The boundary is the top of the newly measured (tighter)
  // band; require dropping below it by the margin before tightening the claim.
  const boundary = upperBoundOf(measuredBand);
  if (boundary === null) return measuredBand;
  return distanceMeters < boundary - marginFor(boundary) ? measuredBand : previousBand;
}

/**
 * Convenience wrapper for callers holding only a distance and a previous band.
 *
 * Deliberately re-derives the band with `bandForDistance` and NOT with
 * `resolveProximityBand`: the confidence cap belongs upstream, and applying it
 * twice would be a silent second widening. Used by tests and by callers that
 * have already applied their own cap.
 */
export function stabilizeDistance(
  distanceMeters: number,
  previousBand: ProximityBand | null | undefined
): ProximityBand {
  return stabilizeBand(bandForDistance(distanceMeters), distanceMeters, previousBand);
}
