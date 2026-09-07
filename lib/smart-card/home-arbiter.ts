import type { ActivationState } from "@/lib/activation/state";
import type { SmartCardTier } from "@/lib/smart-card/catalog";
import { smartCardTier } from "@/lib/smart-card/home-gate";
import type { SmartCardId } from "@/lib/smart-card/smart-card";

/**
 * ONE CARD, ARBITRATED ACROSS BOTH CANDIDATE SPACES.
 *
 * Home shows a single adaptive card, which is the right product decision. What
 * was wrong is HOW the one was chosen: Card A (activation / relationship) and
 * Card B (the Smart Card) each decided independently, and Card A simply
 * rendered whenever it had anything to say. Card B was then merely `deferred`
 * beside it, or gated out entirely.
 *
 * So a tier-1 obligation -- somebody waiting on an answer -- could sit quiet or
 * unrendered underneath a tier-4 nudge, because the nudge belonged to the
 * surface that got to go first. One card had come to mean half the
 * intelligence, which is the defect. It is not that Card A is wrong to exist;
 * it is that nothing ever compared the two.
 *
 * This module is that comparison, and it is the ONLY place the choice is made.
 * Both surfaces' candidates are placed on the SAME tier ladder and the highest
 * one wins:
 *
 *   tier 0  safety / truth                a live journey outranks everything
 *   tier 1  someone needs your answer     a person is actually waiting
 *   tier 2  live coordination             something is happening now
 *   tier 3  critical activation           the product cannot pay off yet
 *   tier 4  social momentum               a real, timely human moment
 *   tier 5  opportunity / progression     useful when nothing above applies
 *   tier 6  fallback                      never nothing
 *
 * DETERMINISTIC, and deliberately so: no scoring model, no personalisation, no
 * rotation, no randomness. The same inputs produce the same card every time,
 * which is what makes the result explainable to the person seeing it and
 * debuggable by us. Ties break toward the OTHER surface's candidate never
 * silently winning -- see `HOME_TIE_BREAK`.
 *
 * NearbyHero is not arbitrated here. It is a separate surface with its own job
 * (the proximity payoff, with avatars and Glow colour), and it was never in
 * competition for this slot.
 */

/** Which surface owns the card Home should render. */
export type HomeCardWinner = "card_a" | "card_b" | "none";

/**
 * Tier for each Card A state, on the SAME ladder as the Smart Card catalog.
 *
 * These are not new judgements invented for the arbiter -- each one is the tier
 * the equivalent Card B state already carries, so the two surfaces are ranked
 * by one shared standard rather than two private ones:
 *
 *   no_muddies / request_pending / visibility_off / muddies_no_location
 *     tier 3, CRITICAL ACTIVATION. Nothing in the product can pay off until
 *     these are solved, so they outrank momentum and opportunity -- but they
 *     do NOT outrank a person waiting on an answer (tier 1) or something
 *     happening right now (tier 2). Someone with no Muddies who nonetheless
 *     has an incoming Muddy request should be shown the request: it is the
 *     very thing that solves the activation state.
 *
 *   muddy_nearby
 *     tier 4, SOCIAL MOMENTUM. A real, timely moment, ranked exactly like
 *     Card B's own momentum states.
 *
 *   location_stale / no_one_nearby
 *     tier 5, OPPORTUNITY / PROGRESSION. Honest and worth saying when nothing
 *     stronger applies, and not worth interrupting for when something is.
 *
 *   upcoming_plan
 *     tier 6. Four surfaces already own Plans, each naming the actual Plan and
 *     the actual next step, while this one links generically to /plans. It is
 *     kept rankable rather than special-cased, and it loses to all of them.
 *
 *   activated
 *     Card A renders nothing at all, so it is not a candidate.
 */
const CARD_A_TIER: Record<Exclude<ActivationState, "activated">, SmartCardTier> = {
  no_muddies: 3,
  request_pending: 3,
  visibility_off: 3,
  muddies_no_location: 3,
  muddy_nearby: 4,
  location_stale: 5,
  no_one_nearby: 5,
  upcoming_plan: 6
};

/**
 * The FirstMuddyCard's tier.
 *
 * It is the relationship payoff for a first connection, and the catalog already
 * ranks that exact moment: `first_muddy` is tier 3. Reusing the number keeps
 * the two surfaces honest about it being the same event.
 */
export const FIRST_MUDDY_TIER: SmartCardTier = 3;

/**
 * How a tie is broken when both surfaces offer the same tier.
 *
 * CARD A WINS TIES. At equal urgency the activation surface is the more
 * specific statement -- it names the viewer's own situation and the single
 * action that changes it -- while Card B at the same tier is one of many
 * possible states. Fixing the winner also matters more than which way it goes:
 * an unstable tie-break would make Home flicker between two cards on
 * indistinguishable loads, which is exactly the "random rotation" this
 * arbitration exists to rule out.
 */
export const HOME_TIE_BREAK: HomeCardWinner = "card_a";

export type HomeArbitrationInput = {
  /** The Card A state, or null when Card A has nothing to say. */
  activationState: ActivationState | null;
  /** Whether FirstMuddyCard is showing, which REPLACES the activation card. */
  firstMuddyVisible: boolean;
  /** The Card B candidate, or null when the engine produced none. */
  smartCardId: SmartCardId | null;
  /**
   * Is activation still Home's main guide?
   *
   * Kept from the previous gate, and it still only ever RESTRAINS Card B: a
   * weak state (tier 3 and below in urgency terms, i.e. numerically > 2) does
   * not interrupt a new viewer. It can no longer suppress an obligation,
   * because tiers 0-2 are exempt.
   */
  earlyActivation: boolean;
};

export type HomeArbitration = {
  /** Which surface renders. Exactly one, or none. */
  winner: HomeCardWinner;
  /** The winning tier, for tests and for reasoning about a live screen. */
  tier: SmartCardTier;
  /** Card A's tier when it had a candidate, else null. */
  cardATier: SmartCardTier | null;
  /** Card B's tier when it had a candidate and was eligible, else null. */
  cardBTier: SmartCardTier | null;
  /** Why the loser lost. Diagnostic only; never rendered. */
  reason:
    | "no_candidates"
    | "card_a_only"
    | "card_b_only"
    | "card_a_higher_tier"
    | "card_b_higher_tier"
    | "tie_broken";
};

/** Card A's tier, or null when Card A has no candidate. */
export function cardACandidateTier(input: {
  activationState: ActivationState | null;
  firstMuddyVisible: boolean;
}): SmartCardTier | null {
  /* FirstMuddyCard REPLACES the activation card, so it is checked first and
     the activation state underneath it is not also a candidate. */
  if (input.firstMuddyVisible) return FIRST_MUDDY_TIER;
  if (!input.activationState || input.activationState === "activated") return null;
  return CARD_A_TIER[input.activationState];
}

/**
 * Card B's tier, or null when it has no candidate or is not eligible.
 *
 * The early-activation restraint is preserved exactly as the previous gate
 * applied it, including the tier 0-2 exemption: safety, an owed answer and live
 * coordination reach every viewer no matter how new.
 */
export function cardBCandidateTier(input: {
  smartCardId: SmartCardId | null;
  earlyActivation: boolean;
}): SmartCardTier | null {
  if (!input.smartCardId) return null;
  const tier = smartCardTier(input.smartCardId);
  if (tier <= 2) return tier;
  return input.earlyActivation ? null : tier;
}

/**
 * Pick the ONE card Home renders.
 *
 * A lower tier number is more urgent, so the winner is the smaller of the two.
 */
export function arbitrateHomeCard(input: HomeArbitrationInput): HomeArbitration {
  const cardATier = cardACandidateTier(input);
  const cardBTier = cardBCandidateTier(input);

  if (cardATier === null && cardBTier === null) {
    return { winner: "none", tier: 6, cardATier, cardBTier, reason: "no_candidates" };
  }
  if (cardBTier === null) {
    return { winner: "card_a", tier: cardATier!, cardATier, cardBTier, reason: "card_a_only" };
  }
  if (cardATier === null) {
    return { winner: "card_b", tier: cardBTier, cardATier, cardBTier, reason: "card_b_only" };
  }

  if (cardATier < cardBTier) {
    return { winner: "card_a", tier: cardATier, cardATier, cardBTier, reason: "card_a_higher_tier" };
  }
  if (cardBTier < cardATier) {
    return { winner: "card_b", tier: cardBTier, cardATier, cardBTier, reason: "card_b_higher_tier" };
  }
  return { winner: HOME_TIE_BREAK, tier: cardATier, cardATier, cardBTier, reason: "tie_broken" };
}
