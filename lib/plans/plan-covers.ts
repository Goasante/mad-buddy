import type { PlanCategory } from "@/lib/supabase/database.types";

/**
 * The canonical Plan Cover system.
 *
 * One resolver, used by every plan surface (Home, the Plans page, and
 * anything added later), so a plan looks the same wherever it appears and no
 * component hardcodes an image path or a colour.
 *
 * Adding a new cover type is a registry entry plus a category value — no UI
 * component changes.
 *
 * This module is pure data + one function: no React, no fetching, no
 * Supabase, so the whole priority chain is testable without a DOM.
 */

/** Where a rendered cover came from. Useful for tests and debugging. */
export type PlanCoverSource = "upload" | "canonical" | "fallback";

/**
 * A cover's visual definition.
 *
 * Canonical covers are described as data — two brand-palette stops and a
 * geometric motif — rather than as image files. That keeps them crisp at any
 * size, themeable, free of network cost, and addable without shipping assets.
 */
export type PlanCoverArt = {
  /** Gradient stops, darkest last. Authored to keep white text ≥ 4.5:1. */
  from: string;
  to: string;
  /** Which geometric motif the cover component draws. */
  motif: PlanCoverMotif;
};

export type PlanCoverMotif =
  | "waves"
  | "plate"
  | "cup"
  | "book"
  | "screen"
  | "pitch"
  | "controller"
  | "stage"
  | "confetti"
  | "compass"
  | "pulse"
  | "sparkle"
  | "basket"
  | "peaks"
  | "route"
  | "mark";

export type ResolvedPlanCover =
  | { source: "upload"; imageUrl: string; art: null; label: string }
  | { source: "canonical"; imageUrl: null; art: PlanCoverArt; label: string }
  | { source: "fallback"; imageUrl: null; art: PlanCoverArt; label: string };

/**
 * The canonical cover library.
 *
 * Palettes are drawn from the Mad Buddy range (warm oranges and pinks through
 * to cool violets and teals) and are deliberately deep rather than pastel:
 * the card overlays white text on them, so every pair is dark enough to carry
 * it in both themes.
 */
export const PLAN_COVERS: Record<PlanCategory, PlanCoverArt> = {
  beach: { from: "#0ea5e9", to: "#0369a1", motif: "waves" },
  dinner: { from: "#e88c2b", to: "#c2410c", motif: "plate" },
  coffee: { from: "#a16207", to: "#5c3a12", motif: "cup" },
  study: { from: "#6366f1", to: "#3730a3", motif: "book" },
  movie: { from: "#7c3aed", to: "#4c1d95", motif: "screen" },
  football: { from: "#10b981", to: "#065f46", motif: "pitch" },
  gaming: { from: "#8b5cf6", to: "#5b21b6", motif: "controller" },
  concert: { from: "#d946ef", to: "#86198f", motif: "stage" },
  birthday: { from: "#ec4899", to: "#9d174d", motif: "confetti" },
  travel: { from: "#0891b2", to: "#155e75", motif: "compass" },
  workout: { from: "#ef4444", to: "#991b1b", motif: "pulse" },
  party: { from: "#c2255c", to: "#831843", motif: "sparkle" },
  picnic: { from: "#65a30d", to: "#3f6212", motif: "basket" },
  hiking: { from: "#059669", to: "#134e4a", motif: "peaks" },
  road_trip: { from: "#f59e0b", to: "#b45309", motif: "route" }
};

/**
 * The branded fallback, used when a plan has neither an upload nor a
 * category. Mad Buddy's own palette and mark — never a stock photo, a map, a
 * profile picture, or a generic grey gradient.
 */
export const PLAN_COVER_FALLBACK: PlanCoverArt = {
  from: "#b81a5c",
  to: "#7a1038",
  motif: "mark"
};

/** Human-readable category names, for accessible labels. */
const CATEGORY_LABEL: Record<PlanCategory, string> = {
  beach: "Beach",
  dinner: "Dinner",
  coffee: "Coffee",
  study: "Study",
  movie: "Movie",
  football: "Football",
  gaming: "Gaming",
  concert: "Concert",
  birthday: "Birthday",
  travel: "Travel",
  workout: "Workout",
  party: "Party",
  picnic: "Picnic",
  hiking: "Hiking",
  road_trip: "Road trip"
};

export function planCategoryLabel(category: PlanCategory): string {
  return CATEGORY_LABEL[category];
}

/** Every category, in registry order — for a category picker. */
export const PLAN_CATEGORIES = Object.keys(PLAN_COVERS) as PlanCategory[];

/**
 * Resolve the cover for a plan. THE canonical entry point — every surface
 * calls this rather than reading the fields itself.
 *
 * Priority, first match wins:
 *   1. a user-uploaded cover image
 *   2. the canonical illustration for the plan's category
 *   3. the branded fallback
 *
 * An unrecognised category resolves to the fallback rather than throwing: the
 * database constraint should prevent it, but a plan must always render.
 * Nothing here guesses a category from the title.
 */
export function resolvePlanCover(plan: {
  category?: PlanCategory | string | null;
  coverImageUrl?: string | null;
}): ResolvedPlanCover {
  const uploaded = plan.coverImageUrl?.trim();
  if (uploaded) {
    return { source: "upload", imageUrl: uploaded, art: null, label: "Plan cover" };
  }

  const category = plan.category ?? null;
  if (category && isPlanCategory(category)) {
    return {
      source: "canonical",
      imageUrl: null,
      art: PLAN_COVERS[category],
      label: `${CATEGORY_LABEL[category]} plan`
    };
  }

  return { source: "fallback", imageUrl: null, art: PLAN_COVER_FALLBACK, label: "Plan" };
}

/** Narrowing guard, so an unconstrained string can be checked safely. */
export function isPlanCategory(value: string): value is PlanCategory {
  return Object.prototype.hasOwnProperty.call(PLAN_COVERS, value);
}
