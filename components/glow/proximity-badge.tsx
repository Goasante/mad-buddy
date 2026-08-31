import { Badge } from "@/components/ui/badge";
import type { ProximityLevel } from "@/lib/proximity";
import type { ProximityBand } from "@/lib/proximity/bands";
import { PROXIMITY_BAND_LABELS } from "@/lib/proximity/bands";

export type ProximityBadgeProps = {
  /**
   * The six-state band. Preferred: it is what the API resolves and what the
   * Glow renders, so the badge and the aura always agree.
   */
  band?: ProximityBand | null;
  /**
   * The coarse stored level. Accepted only as a fallback for surfaces that do
   * not yet carry a band; it produces the widest state the level can honestly
   * represent, so it never overstates how close somebody is.
   */
  proximityLevel?: ProximityLevel | null;
  className?: string;
};

/** The band a badge shows, or null when there is nothing to say. */
function resolveBadgeBand(
  band: ProximityBand | null | undefined,
  level: ProximityLevel | null | undefined
): ProximityBand | null {
  if (band) return band === "outside_range" ? null : band;
  if (level === "close") return "around_you";
  if (level === "near") return "nearby";
  if (level === "far") return "further_away";
  return null;
}

/**
 * The tone flips at the halfway point of the scale: the three closer states
 * read as warm and present, the three broader ones as neutral. Six badge
 * colours would fight the Glow, which is the surface that actually carries the
 * six-way distinction.
 */
const NEUTRAL_BANDS = new Set<ProximityBand>(["nearby", "around_town", "further_away"]);

export function ProximityBadge({ band, proximityLevel, className }: ProximityBadgeProps) {
  const resolved = resolveBadgeBand(band, proximityLevel);
  if (!resolved) return null;

  return (
    <Badge variant={NEUTRAL_BANDS.has(resolved) ? "default" : "orange"} className={className}>
      {PROXIMITY_BAND_LABELS[resolved]}
    </Badge>
  );
}
