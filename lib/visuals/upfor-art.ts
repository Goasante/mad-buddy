import type { HangoutActivityType, PlanCategory } from "@/lib/supabase/database.types";
import { planActivityArt, type VisualAsset } from "@/lib/visuals/registry";

/**
 * One semantic authority for photographic UpFor artwork.
 *
 * An activity only receives a photo when the approved visual registry contains
 * an image that actually depicts that activity. Missing art is deliberate: UI
 * consumers must render their branded/activity-icon fallback instead of
 * borrowing an unrelated photograph.
 */
export type UpForActivityArtwork = {
  asset: VisualAsset;
  /** Shared crop anchor for CSS backgrounds and next/image consumers. */
  objectPosition: string;
};

type UpForArtworkRule = {
  category: PlanCategory;
  objectPosition: string;
};

const UPFOR_ACTIVITY_ART: Partial<Record<HangoutActivityType, UpForArtworkRule>> = {
  food: { category: "dinner", objectPosition: "50% 50%" },
  sports: { category: "football", objectPosition: "50% 50%" },
  // walk had no photograph of its own until 2026-09-10 and borrowed beach's
  // as a placeholder. It now has approved art that actually depicts walking,
  // so it maps to its own category instead.
  walk: { category: "walk", objectPosition: "50% 50%" },
  chill: { category: "beach", objectPosition: "50% 50%" },
  coffee: { category: "coffee", objectPosition: "50% 50%" },
  football: { category: "football", objectPosition: "50% 50%" },
  movie: { category: "movie", objectPosition: "50% 50%" },
  party: { category: "party", objectPosition: "50% 50%" },
  // study and gaming gained approved replacement photography on 2026-09-10:
  // study's original candidate had a visible Apple logo, and gaming's was
  // never reviewed. Both were previously in the "deliberately unmapped" list
  // below.
  study: { category: "study", objectPosition: "50% 50%" },
  gaming: { category: "gaming", objectPosition: "50% 50%" }
};

/**
 * Approved UpFor photography for an activity, or null when no honest photo is
 * available. Never throws: artwork is decoration and must not break UpFor.
 *
 * Deliberately unmapped today: gym, drinks, drive and anything. Their
 * available candidates are missing, rejected, or semantically wrong.
 */
export function resolveUpForActivityArtwork(
  activity: HangoutActivityType | null | undefined
): UpForActivityArtwork | null {
  if (!activity) return null;
  const rule = UPFOR_ACTIVITY_ART[activity];
  if (!rule) return null;

  const asset = planActivityArt(rule.category);
  if (!asset) return null;
  return { asset, objectPosition: rule.objectPosition };
}
