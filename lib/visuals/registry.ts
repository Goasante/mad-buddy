import type { PlanCategory } from "@/lib/supabase/database.types";

/**
 * The canonical visual registry.
 *
 * ONE PLACE THAT KNOWS WHERE ARTWORK LIVES, so no component hardcodes a path
 * and no surface can quietly start using an image that failed review.
 *
 * Existing cover systems remain authority. Photography/illustration is layered
 * in front only where a trustworthy semantic authority already exists.
 */

/** Which family an asset belongs to. Mirrors the /public/visuals folders. */
export type VisualFamily = "activity" | "safe_arrival" | "smart_card";

/** What a piece of artwork is FOR, as opposed to what it depicts. */
export type VisualRole = "plan_cover" | "safe_arrival_state" | "smart_card_backdrop";

export type VisualAsset = {
  /** Stable id, independent of the source filename. */
  id: string;
  /** Public path. Always under /visuals so the origin of a file is obvious. */
  path: string;
  family: VisualFamily;
  role: VisualRole;
  /** Width/height of the shipped file, for correct sizing without a probe. */
  width: number;
  height: number;
  /** What the image ACTUALLY depicts -- verified by looking, not by filename. */
  depicts: string;
};

/**
 * Plan categories that have approved photography.
 *
 * PARTIAL BY DESIGN. Categories without approved photography resolve to the
 * canonical CSS cover rather than receiving semantically wrong artwork.
 */
const PLAN_ACTIVITY_ART: Partial<Record<PlanCategory, VisualAsset>> = {
  coffee: {
    id: "activity-coffee",
    path: "/visuals/activities/coffee.jpg",
    family: "activity",
    role: "plan_cover",
    width: 793,
    height: 496,
    depicts: "Two people talking over coffee in a cafe"
  },
  beach: {
    id: "activity-beach",
    path: "/visuals/activities/beach.jpg",
    family: "activity",
    role: "plan_cover",
    width: 793,
    height: 496,
    depicts: "Friends sitting on a beach at golden hour"
  },
  dinner: {
    id: "activity-dinner",
    path: "/visuals/activities/dinner.jpg",
    family: "activity",
    role: "plan_cover",
    width: 793,
    height: 496,
    depicts: "A group sharing dinner at a warmly lit restaurant"
  },
  football: {
    id: "activity-football",
    path: "/visuals/activities/football.jpg",
    family: "activity",
    role: "plan_cover",
    width: 768,
    height: 512,
    depicts: "A five-a-side football match on grass at sunset"
  },
  picnic: {
    id: "activity-picnic",
    path: "/visuals/activities/picnic.jpg",
    family: "activity",
    role: "plan_cover",
    width: 724,
    height: 543,
    depicts: "Four friends on a picnic blanket in a park"
  },
  party: {
    id: "activity-party",
    path: "/visuals/activities/party.jpg",
    family: "activity",
    role: "plan_cover",
    width: 724,
    height: 543,
    depicts: "People dancing at a night party"
  },
  movie: {
    id: "activity-movie",
    path: "/visuals/activities/movie.jpg",
    family: "activity",
    role: "plan_cover",
    width: 768,
    height: 512,
    depicts: "Two people watching a film in a cinema"
  },
  concert: {
    id: "activity-concert",
    path: "/visuals/activities/concert.jpg",
    family: "activity",
    role: "plan_cover",
    width: 724,
    height: 543,
    depicts: "A crowd facing a lit stage at a concert"
  }
};

/**
 * Safe Arrival artwork, keyed by Journey-state meaning rather than filenames.
 * Nothing here contains a map, route, pin, distance or live-location claim.
 */
const SAFE_ARRIVAL_ART: Record<string, VisualAsset> = {
  in_transit: {
    id: "safe-arrival-in-transit",
    path: "/visuals/safe-arrival/active.jpg",
    family: "safe_arrival",
    role: "safe_arrival_state",
    width: 724,
    height: 543,
    depicts: "Abstract travelling light with a sense of motion"
  },
  arrived: {
    id: "safe-arrival-arrived",
    path: "/visuals/safe-arrival/complete.jpg",
    family: "safe_arrival",
    role: "safe_arrival_state",
    width: 724,
    height: 543,
    depicts: "Abstract settled warm glow"
  }
};

/**
 * The approved Smart Card editorial fallback atlas.
 *
 * It contains six deliberately mixed/neutral social scenes arranged 3x2:
 * UpFor, relationship request, birthday, Linkr/social connection, Plan/Event,
 * and Safe Arrival/in-transit. The renderer crops the atlas by PRODUCT FAMILY;
 * the illustrated people are never presented as the named Muddy/Linkr person.
 *
 * A display name is not gender authority. Real viewer-authorized user/Event
 * media wins whenever a card has it. Gendered variants must not be selected
 * from a name; they require explicit viewer-authorized presentation data.
 */
const SMART_CARD_EDITORIAL_ATLAS: VisualAsset = {
  id: "smart-card-editorial-atlas",
  path: "/visuals/smart-card/editorial-atlas.webp",
  family: "smart_card",
  role: "smart_card_backdrop",
  width: 1800,
  height: 880,
  depicts: "Six warm editorial illustrations of mixed social moments for neutral Smart Card backgrounds"
};

// ---------------------------------------------------------------------------
// Resolvers. Every one degrades safely rather than throwing.
// ---------------------------------------------------------------------------

/** Approved photography for a Plan category, or null to use the CSS cover. */
export function planActivityArt(category: PlanCategory | null | undefined): VisualAsset | null {
  if (!category) return null;
  return PLAN_ACTIVITY_ART[category] ?? null;
}

/** Artwork for a Safe Arrival journey key, or null when the state carries none. */
export function resolveSafeArrivalArtwork(journeyKey: string | null | undefined): VisualAsset | null {
  if (!journeyKey) return null;
  return SAFE_ARRIVAL_ART[journeyKey] ?? null;
}

/** Artwork keyed by the display tone Safe Arrival screens already compute. */
export function safeArrivalArtworkForTone(tone: string | null | undefined): VisualAsset | null {
  switch (tone) {
    case "transit":
    case "extended":
      return SAFE_ARRIVAL_ART.in_transit;
    case "arrived":
      return SAFE_ARRIVAL_ART.arrived;
    default:
      return null;
  }
}

/** Approved neutral fallback atlas for Smart Card B. */
export function smartCardEditorialAtlas(): VisualAsset {
  return SMART_CARD_EDITORIAL_ATLAS;
}

/** Every asset the runtime can reach. Used by tests to police the boundary. */
export function allRegisteredAssets(): VisualAsset[] {
  return [
    ...Object.values(PLAN_ACTIVITY_ART).filter((a): a is VisualAsset => Boolean(a)),
    ...Object.values(SAFE_ARRIVAL_ART),
    SMART_CARD_EDITORIAL_ATLAS
  ];
}
