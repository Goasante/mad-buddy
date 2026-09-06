import type { HangoutActivityType, PlanCategory } from "@/lib/supabase/database.types";
import type { SmartCard, SmartCardMedia } from "@/lib/smart-card/smart-card";
import { planActivityArt } from "@/lib/visuals/registry";

/**
 * The visual-volume contract for Home's Smart Card.
 *
 * Home can also be showing the separate Activation / Relationship card. When
 * that card owns the screen, the Smart Card is rendered in `quiet` mode so two
 * hero treatments never compete. Safety also has its own calm treatment and
 * never inherits photographic or animated decoration by accident.
 */
export type SmartCardVisualTreatment = "quiet" | "safety" | "media" | "branded";

export function smartCardVisualTreatment(card: SmartCard, deferred: boolean): SmartCardVisualTreatment {
  if (deferred) return "quiet";
  if (card.id === "safe_arrival") return "safety";
  if (card.media?.url) return "media";
  return "branded";
}

/**
 * Approved curated Plan photography, resolved through the existing visual
 * registry. Missing/rejected categories return undefined and therefore fall
 * back to the branded Smart Card treatment; no component invents a file path.
 */
export function curatedPlanSmartCardMedia(
  category: PlanCategory | null | undefined,
  title: string
): SmartCardMedia | undefined {
  const asset = planActivityArt(category);
  if (!asset) return undefined;
  return {
    url: asset.path,
    alt: `${title}: ${asset.depicts}`
  };
}

/**
 * UpFor activity -> approved artwork, mapped ONLY where the picture is honest.
 *
 * The registry is keyed by PlanCategory, and the two vocabularies overlap
 * without matching. A mapping is included only when the existing photograph
 * genuinely depicts the activity:
 *
 *   food     -> dinner     a meal
 *   coffee   -> coffee     exact
 *   football -> football   exact
 *   sports   -> football   the only sport photographed; honest enough
 *   party    -> party      exact
 *   movie    -> movie      exact
 *   walk     -> beach      a walk outdoors
 *
 * Deliberately unmapped: `gym`, `study`, `gaming`, `drinks`, `drive`, `chill`
 * and `anything`. No approved photograph depicts them, and dressing a study
 * session in a picnic photo is the kind of small lie that makes a product feel
 * generic. Those fall through to the branded treatment, which is a real
 * design, not a failure state.
 */
const UPFOR_ACTIVITY_ART: Partial<Record<HangoutActivityType, PlanCategory>> = {
  food: "dinner",
  coffee: "coffee",
  football: "football",
  sports: "football",
  party: "party",
  movie: "movie",
  walk: "beach"
};

export function upForActivitySmartCardMedia(
  activity: HangoutActivityType,
  label: string
): SmartCardMedia | undefined {
  const category = UPFOR_ACTIVITY_ART[activity];
  if (!category) return undefined;
  const asset = planActivityArt(category);
  if (!asset) return undefined;
  return { url: asset.path, alt: `${label}: ${asset.depicts}` };
}
