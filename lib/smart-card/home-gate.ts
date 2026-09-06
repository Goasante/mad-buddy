import { SMART_CARD_APPROVED_STATES, type SmartCardTier } from "@/lib/smart-card/catalog";
import type { SmartCardId } from "@/lib/smart-card/smart-card";

/**
 * Which Smart Card states Home may show, and how loudly.
 *
 * Home runs three surfaces with different jobs:
 *
 *   CARD A  FirstMuddyCard / ActivationCard -- activation and relationship
 *           progression: first Muddy, Glow and visibility setup, the
 *           quiet-evening relationship action.
 *   CARD B  the Smart Card -- cross-product obligations, live social context,
 *           opportunities, progression, fallback.
 *   NEARBY  NearbyHero -- the proximity payoff.
 *
 * The old Home condition was `smartCard.id === "safe_arrival" ||
 * composition.showJourneyCard`. That admitted two of fourteen built states, so
 * Plan RSVP, live Events and the rest were computed on every load and thrown
 * away. Replacing it with a longer list of ids would have the same defect
 * later, one state at a time, so eligibility is decided by TIER instead:
 *
 *   tier 0  safety / truth                 always
 *   tier 1  someone needs your answer      always
 *   tier 2  something is happening now     always
 *   tier 3-6 momentum, opportunity,        only once early activation has
 *            progression, fallback         stopped being Home's main guide
 *
 * A new state added to the catalog therefore inherits the right behaviour from
 * its tier without anybody editing Home.
 */

/** States another Home surface owns. Card B must not select them HERE. */
const HOME_OWNED_ELSEWHERE: Record<string, string> = {
  /* NearbyHero owns the proximity payoff, with avatars, Glow colour and its own
     actions. A Smart Card saying "Ama is Close By" directly above it is the app
     saying the same thing twice in one screen. */
  nearby_muddies: "NearbyHero",
  /* Activation owns cold-start people discovery -- it is the whole point of the
     no_muddies state. Two cards both saying "find your first Muddy" is the
     repetition activation exists to avoid. */
  suggestions: "ActivationCard"
};

/**
 * Tier for a wired Smart Card id.
 *
 * Read from the approved catalog so the tier has ONE definition. A few wired
 * ids are pluralised variants of a catalog entry (`nearby_muddies` covers
 * `nearby_muddy`), which the alias map below resolves rather than duplicating
 * the tier next to the provider where it could drift.
 */
const TIER_ALIASES: Partial<Record<SmartCardId, string>> = {
  nearby_muddies: "nearby_muddy",
  /* The wired safety provider is one card covering the whole live-journey
     state; the catalog splits the same ground into safe_arrival_overdue and
     safe_arrival_action. Without this alias the id is unlisted and falls to the
     unknown-state default, which would put a live Safe Arrival behind the
     maturity gate -- survivable only because tier 0 short-circuits first, and
     not something to leave resting on that. */
  safe_arrival: "safe_arrival_action"
};

const TIER_BY_CATALOG_ID = new Map<string, SmartCardTier>(
  SMART_CARD_APPROVED_STATES.map((state) => [state.id, state.tier])
);

export function smartCardTier(id: SmartCardId): SmartCardTier {
  const catalogId = TIER_ALIASES[id] ?? id;
  const tier = TIER_BY_CATALOG_ID.get(catalogId);
  /* An unlisted id is a wiring mistake, not a reason to show something at an
     unknown priority. Treating it as fallback keeps it off a mature Home's
     urgent slots instead of silently promoting it. */
  return tier ?? 6;
}

/** Tiers Home shows regardless of how new the viewer is. */
export const ALWAYS_ELIGIBLE_MAX_TIER: SmartCardTier = 2;

export type HomeSmartCardGate = {
  /** May this state appear on Home at all? */
  eligible: boolean;
  /** Render it in the quiet treatment rather than the full one? */
  deferred: boolean;
  tier: SmartCardTier;
};

/**
 * Should Home render this Smart Card, and how loudly?
 *
 * `earlyActivation` is the existing canonical question -- is activation still
 * the main guide on this screen -- and `cardAVisible` is whether either Card A
 * variant is actually on screen right now. They are separate on purpose: a
 * viewer can be past early activation and still see FirstMuddyCard, in which
 * case Card B is eligible but must not compete visually.
 */
export function shouldShowSmartCardOnHome(input: {
  id: SmartCardId;
  earlyActivation: boolean;
  cardAVisible: boolean;
}): HomeSmartCardGate {
  const tier = smartCardTier(input.id);

  /* Safety is never deferred and never gated. A live journey somebody is on
     outranks every teaching moment Home could be having. */
  if (tier === 0) {
    return { eligible: true, deferred: false, tier };
  }

  const eligible = tier <= ALWAYS_ELIGIBLE_MAX_TIER || !input.earlyActivation;
  return { eligible, deferred: eligible && input.cardAVisible, tier };
}

/** Home-surface ownership, for the engine's exclusion list. */
export function homeOwnerFor(id: SmartCardId): string | null {
  return HOME_OWNED_ELSEWHERE[id] ?? null;
}

/** States Card B must skip when resolving for Home. */
export const HOME_EXCLUDED_SMART_CARD_IDS: readonly SmartCardId[] = Object.keys(
  HOME_OWNED_ELSEWHERE
) as SmartCardId[];
