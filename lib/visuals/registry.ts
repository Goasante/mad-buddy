import type { PlanCategory } from "@/lib/supabase/database.types";

/**
 * The canonical visual registry.
 *
 * ONE PLACE THAT KNOWS WHERE ARTWORK LIVES, so no component hardcodes a path
 * and no surface can quietly start using an image that failed review.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO. It does not replace the existing cover
 * systems. `lib/plans/plan-covers.ts` and `lib/events/event-media.ts` describe
 * covers as gradient + motif DATA rather than files, which keeps them crisp at
 * any size, themeable, free of network cost and immune to layout shift. That
 * remains the final fallback everywhere; photography is layered in front of it
 * only where a trustworthy semantic authority already exists.
 *
 * WHICH IS WHY EVENTS AND GROUPS ARE ABSENT. The supplied library contains
 * category artwork for both, but neither `events` nor `groups` has a category
 * column -- so wiring it would have meant inventing a taxonomy to justify the
 * pictures. The schema is authoritative over the asset library; those families
 * stay out of the runtime until categorisation is designed deliberately.
 *
 * REJECTED ART IS NOT REACHABLE FROM HERE. Assets that failed QA are absent
 * from this file and were never copied into /public, so there is no path by
 * which a resolver can return one.
 */

/** Which family an asset belongs to. Mirrors the /public/visuals folders. */
export type VisualFamily = "activity" | "safe_arrival";

/** What a piece of artwork is FOR, as opposed to what it depicts. */
export type VisualRole = "plan_cover" | "safe_arrival_state";

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
 * PARTIAL BY DESIGN. Six of the fifteen categories have no entry, because
 * their candidate images failed review rather than because they were
 * forgotten:
 *
 *   study     -- library scene, but an Apple logo is visible
 *   workout   -- gym scene, but Nike marks on socks and shoes
 *   gaming    -- not reviewed as approved for this pass
 *   birthday  -- no candidate in the library
 *   travel    -- candidate depicts a solo summit, closer to hiking
 *   hiking    -- no approved candidate
 *   road_trip -- not reviewed as approved for this pass
 *
 * Those resolve to the canonical CSS cover, which is a complete answer rather
 * than a gap. Forcing every category to carry a photograph is how a trademark
 * ends up shipped in a product surface.
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
 * NO GENERAL ACTIVITY MASTER.
 *
 * `activity-hangout-general-master` was copied in and registered, and then had
 * no consumer: a plan with no category resolves to PLAN_COVER_FALLBACK -- the
 * branded mark -- which is the honest answer, because a photograph of friends
 * at a table would assert something about a plan nobody has described yet. And
 * it must never stand in for a category whose own art was rejected, or
 * somebody planning a workout is shown a picnic.
 *
 * So it was removed from /public rather than left there unused, the same rule
 * applied to the Home ambient pair and the Safe Arrival "ready" image. It
 * stays in the source library for a surface that genuinely wants "some
 * activity, unspecified".
 */
/**
 * Safe Arrival artwork, keyed by the REAL lifecycle status.
 *
 * THE MISTAKE THIS REPLACES. An earlier version of this registry invented
 * `ready | active | complete | attention` because those were the artwork
 * filenames. Safe Arrival's actual statuses are `draft`,
 * `pending_acknowledgement`, `active`, `extended`, `grace_period`,
 * `unconfirmed`, `completed`, `cancelled` and `expired` -- so the registry was
 * describing a state machine the product does not have. Filenames are not a
 * taxonomy.
 *
 * SUPPORTING VISUALS ONLY. Every status line, timer, control and confirmation
 * stays real UI; this is the backdrop behind JourneyVisual, which is already
 * `aria-hidden` and decorative.
 *
 * All three are abstract light. Nothing shows a map, a route, a pin, a
 * distance or any depiction of where somebody is -- the artwork must not
 * reintroduce what this feature spends so much effort keeping out.
 */
const SAFE_ARRIVAL_ART: Record<string, VisualAsset> = {
  /* NO `starting` ENTRY. The setup screen renders tone="transit" rather than a
   * distinct starting tone, so the "ready" image had no way to reach a screen.
   * It was removed from /public rather than left there unused -- the same rule
   * applied to the Home artwork. It stays in the source library for whenever a
   * setup-specific visual is actually designed. */
  // active / extended / grace_period -- under way.
  in_transit: {
    id: "safe-arrival-in-transit",
    path: "/visuals/safe-arrival/active.jpg",
    family: "safe_arrival",
    role: "safe_arrival_state",
    width: 724,
    height: 543,
    depicts: "Abstract travelling light with a sense of motion"
  },
  // completed -- confirmed arrival.
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
 * WAITING, CANCELLED AND EXPIRED CARRY NO ARTWORK, deliberately.
 *
 * `waiting` (canonical status `unconfirmed`) is the one worth explaining. The
 * obvious move is to hand it the "attention" image, and it is wrong. The
 * lifecycle documents this state as "neutral by construction (spec §9): it
 * reports 'hasn't confirmed yet', never 'missing', and never implies an
 * emergency" -- and it asks nothing of the traveller, who may simply have no
 * signal. Heightened artwork would contradict that in the one place where
 * being wrong frightens somebody. The status chip already carries the
 * distinction in words.
 *
 * `cancelled` and `expired` are endings. The existing neutral treatment says
 * so; artwork would make a closed session look like a live one. The
 * `attention` image was removed from /public rather than left unused, because
 * a shipped file with no consumer is an invitation to find it a job.
 */
// ---------------------------------------------------------------------------
// Resolvers. Every one returns null rather than throwing: a missing asset must
// degrade to the existing CSS treatment, never break the surface it sits on.
// ---------------------------------------------------------------------------

/** Approved photography for a Plan category, or null to use the CSS cover. */
export function planActivityArt(category: PlanCategory | null | undefined): VisualAsset | null {
  if (!category) return null;
  return PLAN_ACTIVITY_ART[category] ?? null;
}

/**
 * Artwork for a Safe Arrival journey key, or null when the state carries none.
 *
 * Takes the JourneyState key that the UI already derives, so this module never
 * re-implements the lifecycle. Returns null -- never throws -- for `waiting`,
 * `cancelled`, `expired` and anything unrecognised.
 */
export function resolveSafeArrivalArtwork(journeyKey: string | null | undefined): VisualAsset | null {
  if (!journeyKey) return null;
  return SAFE_ARRIVAL_ART[journeyKey] ?? null;
}

/**
 * The same answer, keyed by the display TONE the Safe Arrival screens already
 * compute (`journeyTone`).
 *
 * The screens hold a tone rather than a JourneyState key, so this saves every
 * caller from re-deriving the lifecycle. The mapping is deliberately partial:
 *
 *   transit / extended -> in transit
 *   arrived            -> arrived
 *   overdue            -> NOTHING. This is `unconfirmed`, which the lifecycle
 *                         defines as neutral: "hasn't confirmed yet", never
 *                         "missing", never an emergency. The chip already says
 *                         NOT CONFIRMED in words; heightened artwork behind it
 *                         would turn a quiet state into an alarming one.
 *   ended              -> NOTHING. A finished session must not look live.
 */
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

/** Every asset the runtime can reach. Used by tests to police the boundary. */
export function allRegisteredAssets(): VisualAsset[] {
  return [
    ...Object.values(PLAN_ACTIVITY_ART).filter((a): a is VisualAsset => Boolean(a)),
    ...Object.values(SAFE_ARRIVAL_ART)
  ];
}
