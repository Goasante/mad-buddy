import type { ProximityBand } from "@/lib/proximity/bands";
import { bandForDistance, PROXIMITY_BAND_MAX_METERS } from "@/lib/proximity/bands";

/**
 * Band stability: stops the Glow flapping at a boundary, WITHOUT ever
 * overstating how close somebody is.
 *
 * THE PROBLEM. Bands are contiguous and inclusive-upper, so a reading that
 * jitters around 2,000m -- which GPS does constantly, even for a stationary
 * phone -- alternates `close_by` / `nearby` / `close_by` on every refresh. At
 * the old 5km-wide buckets that was rare. At a 100m band it is the normal case,
 * and the redesign makes it visible: the Glow would change energy, layer count
 * and pulse speed every few seconds while nobody moved.
 *
 * THE MODEL: ASYMMETRIC, AND DELIBERATELY SO.
 *
 *   OUTWARD (toward a broader band)  -> immediate, at the canonical boundary.
 *   INWARD  (toward a tighter band)  -> requires clearing the boundary by the
 *                                       stability margin before upgrading.
 *
 * A symmetric Schmitt trigger -- damping both directions, which is the textbook
 * shape -- is WRONG for this product. Damping the outward direction means the
 * UI keeps showing a TIGHTER label after the accepted measurement has already
 * moved into a broader band: "Close By" about somebody the data now places in
 * "In Your Area". That is the UI making a closeness claim the measurement does
 * not support, and for a proximity feature it is the one error that actually
 * matters. Being briefly too conservative costs nothing; being briefly too
 * intimate is a privacy failure.
 *
 * So only the CLAIM that needs evidence is damped. Moving further away is
 * believed instantly; moving closer has to earn it.
 *
 * WHY THIS STILL STOPS FLAPPING. Oscillation needs both directions to be
 * twitchy. With inward transitions gated, a reading hovering at a boundary
 * settles into the broader band and stays there: it can drop outward freely,
 * but it cannot climb back until it is unambiguously inside the tighter band.
 * The 1990 -> 2010 -> 1995 -> 2008 pattern ends in `nearby` and never returns
 * to `close_by`, which is both stable and honest.
 *
 * WHY THIS IS NOT FAKE PRECISION. It never claims a tighter band than the
 * measurement supports -- structurally it cannot, because the only damped
 * direction is the one that would tighten. It can only hold somebody in a band
 * at least as broad as the raw reading.
 *
 * WHY IT IS PRIVACY-SAFE. It takes metres computed server-side and returns a
 * band identifier, exactly as resolveProximityBand does. The previous band is a
 * band identifier too -- no coordinates, no history, no timestamps are kept.
 * Nothing here is sent to a client, nothing narrows a band below what
 * confidence already permitted, and nothing touches the 15km eligibility gate.
 */

/**
 * How far INSIDE a boundary a reading must be before the tighter band is shown.
 *
 * Applies to inward (closer) transitions only -- outward transitions are
 * immediate, so this margin never delays somebody being reported further away.
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

  // MOVING OUTWARD: never damped. The moment the accepted measurement belongs
  // to a broader band, the broader band is shown.
  //
  // This direction is deliberately asymmetric with the one below, and the
  // asymmetry is the whole point. Damping outward movement would keep a
  // TIGHTER label on screen after the measurement had already said the person
  // is further away -- the UI would be overstating closeness on the strength of
  // a reading it no longer has. For a proximity feature that is the one error
  // that actually matters: saying "Close By" about somebody the data places in
  // "In Your Area" is a claim the measurement does not support.
  //
  // Being briefly too conservative is harmless; being briefly too intimate is
  // not. So outward transitions are immediate at the canonical boundary.
  if (measuredIndex > previousIndex) return measuredBand;

  // MOVING INWARD: damped. Upgrading to a tighter band is the claim that needs
  // evidence, so it requires clearing the boundary by the stability margin.
  // Until then the person stays in the broader band they were already shown in
  // -- which is the conservative answer, and also what stops a reading that
  // hovers on a boundary from flickering between two states.
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
