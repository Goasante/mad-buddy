import type { HangoutActivityType, PlanCategory } from "@/lib/supabase/database.types";
import type { SmartCard, SmartCardMedia } from "@/lib/smart-card/smart-card";
import { planActivityArt } from "@/lib/visuals/registry";
import { resolveUpForActivityArtwork } from "@/lib/visuals/upfor-art";

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
 * UpFor Smart Cards use the same semantic artwork authority as UpFor itself.
 * A missing photo is intentional and falls through to the branded treatment;
 * this surface never substitutes coffee for Study, movie for Gaming, etc.
 */
export function upForActivitySmartCardMedia(
  activity: HangoutActivityType,
  label: string
): SmartCardMedia | undefined {
  const artwork = resolveUpForActivityArtwork(activity);
  if (!artwork) return undefined;
  return {
    url: artwork.asset.path,
    alt: `${label}: ${artwork.asset.depicts}`
  };
}
