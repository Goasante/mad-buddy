import type { ConfidenceLevel, ProximityLevel } from "@/lib/proximity";
import type { ProximityBand } from "@/lib/proximity/bands";
import { PROXIMITY_BAND_LABELS } from "@/lib/proximity/bands";

/**
 * Presentation rules for the Muddies page.
 *
 * Pure, so the ordering and labelling can be tested without rendering. Nothing
 * here reads location: it works from the already privacy-filtered proximity
 * signal the nearby API returns, never from coordinates.
 */

export type MuddyProximity = {
  proximityLevel: ProximityLevel;
  /**
   * The six-state presentation band from the API.
   *
   * Optional so surfaces still mid-migration keep compiling; where it is
   * absent the rail falls back to the coarse level, which is less informative
   * but never wrong.
   */
  proximityBand?: ProximityBand;
  glowStrength: number;
  confidence: ConfidenceLevel;
  /** Privacy-safe presence string from the API. Never a timestamp. */
  lastActiveEstimate?: string;
};

/**
 * Distance wording on the closest rail.
 *
 * The glow classes have used this vocabulary since proximity shipped
 * (`proximity-halo-very-close`, `-nearby`, `-around`), so the rail says what
 * the ring already means rather than inventing a second scale.
 */
/**
 * Distance wording on the closest rail.
 *
 * Now the six approved Proximity Glow state names, read from the canonical
 * band table rather than re-typed here -- a second copy of the copy is how the
 * rail and the Glow start disagreeing about what a state is called.
 */
export function railDistanceLabel(proximity: MuddyProximity | undefined): string {
  const band = proximity?.proximityBand;
  if (band && band !== "outside_range") return PROXIMITY_BAND_LABELS[band];

  // No band: fall back to the coarse level. Deliberately maps to the WIDEST
  // state each level can represent, so the fallback can never overstate how
  // close somebody is.
  const level = proximity?.proximityLevel ?? "hidden";
  if (level === "close") return PROXIMITY_BAND_LABELS.around_you;
  if (level === "near") return PROXIMITY_BAND_LABELS.nearby;
  if (level === "far") return PROXIMITY_BAND_LABELS.further_away;
  return "Hidden";
}

/**
 * Rail hue per distance band.
 *
 * Warm for the closest, cool as they get further out, so the row reads as a
 * gradient of distance at a glance. Returns a class the stylesheet resolves;
 * the component never picks colours itself.
 */
export function railToneClass(level: ProximityLevel): string {
  if (level === "close") return "muddies-rail-tone-close";
  if (level === "near") return "muddies-rail-tone-near";
  if (level === "far") return "muddies-rail-tone-far";
  return "muddies-rail-tone-hidden";
}

/** Sort priority: closest first, then by name. Hidden never reaches the rail. */
const PROXIMITY_RANK: Record<ProximityLevel, number> = {
  close: 0,
  near: 1,
  far: 2,
  hidden: 3
};

export function proximityRank(level: ProximityLevel | undefined): number {
  return level ? PROXIMITY_RANK[level] : PROXIMITY_RANK.hidden;
}

/** How many people the closest rail shows before "View map" takes over. */
export const MUDDIES_RAIL_LIMIT = 8;

/**
 * The people on the closest rail: those with a live proximity signal, nearest
 * first. Anyone hidden or without a signal is left out entirely rather than
 * shown greyed — an empty ring on a rail called "Who's closest to you" would
 * imply a distance nobody actually reported.
 */
export function closestMuddies<T extends { id: string; displayName: string }>(
  people: readonly T[],
  proximityById: Readonly<Record<string, MuddyProximity>>,
  limit: number = MUDDIES_RAIL_LIMIT
): T[] {
  return people
    .filter((person) => {
      const level = proximityById[person.id]?.proximityLevel;
      return level === "close" || level === "near" || level === "far";
    })
    .sort(
      (a, b) =>
        proximityRank(proximityById[a.id]?.proximityLevel) -
          proximityRank(proximityById[b.id]?.proximityLevel) ||
        a.displayName.localeCompare(b.displayName)
    )
    .slice(0, limit);
}

/**
 * Presence line under a name.
 *
 * "Online" is reserved for a live signal. Everything else repeats the API's
 * own estimate, which is deliberately coarse — the server never sends an exact
 * last-seen time, so this cannot render one.
 */
export function presenceLabel(proximity: MuddyProximity | undefined): string | null {
  if (!proximity) return null;
  if (proximity.lastActiveEstimate) return proximity.lastActiveEstimate;
  return proximity.proximityLevel === "close" ? "Online" : null;
}

/** True when the dot beside a name should read as live rather than idle. */
export function isOnline(proximity: MuddyProximity | undefined): boolean {
  return proximity?.lastActiveEstimate === "Active recently";
}

export type MuddiesFilterId = "all" | "very_close" | "nearby";

/**
 * The filter row.
 *
 * Distance only. Every entry answers from data the page already holds — a chip
 * that quietly returned the unfiltered list would be worse than no chip.
 *
 * "New Here" is deliberately absent: nothing on this page knows when a Muddy
 * joined, so it could only ever have matched nobody or everybody.
 */
export const MUDDIES_FILTERS: ReadonlyArray<{ id: MuddiesFilterId; label: string }> = [
  { id: "all", label: "All" },
  { id: "very_close", label: "Very Close" },
  { id: "nearby", label: "Nearby" }
];

export function matchesMuddiesFilter(
  filter: MuddiesFilterId,
  proximity: MuddyProximity | undefined
): boolean {
  if (filter === "all") return true;
  if (filter === "very_close") return proximity?.proximityLevel === "close";
  return proximity?.proximityLevel === "near";
}
