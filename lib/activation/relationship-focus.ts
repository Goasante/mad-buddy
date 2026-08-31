import {
  planActionsForMuddy,
  type ConversationState,
  type MuddyActionPlan
} from "@/lib/activation/state";

/**
 * Which relationship Home should talk about, and what to offer for it.
 *
 * "MESSAGE A MUDDY" IS NOT A RELATIONSHIP. Home knew the person had a real
 * Muddy and still offered a generic errand, which made the screen feel
 * disconnected from the connection that had just activated the product. Naming
 * the actual person costs nothing and is the whole difference between a
 * to-do list and something social.
 *
 * DETERMINISTIC, NOT RANKED. No score, no recommender, no learning. The order
 * below is a stated priority a person could read back and agree with, and the
 * same inputs always choose the same Muddy -- so the card cannot reshuffle
 * between two renders of one screen.
 *
 * SHOWN BECAUSE THEY ARE RELEVANT, NEVER BECAUSE THEY ARE NEAR. Nothing here
 * consumes proximity: the nearby payoff belongs to NearbyHero, and a row that
 * borrowed its language would imply a closeness this data does not claim.
 */

export type FocusCandidate = {
  /** Safe identity only. No location, no proximity, no decoration. */
  id: string;
  displayName: string;
  avatarUrl: string | null;
  /** Milliseconds since epoch the friendship began. Newest wins the tiebreak. */
  connectedAtMs: number;
  hasSharedUpcomingPlan: boolean;
  /**
   * How far the conversation has actually got.
   *
   * "none" covers both no thread and a thread nobody has spoken in -- the row
   * existing is not evidence anybody said anything.
   */
  conversationState: ConversationState;
  /** Last message in that conversation, for the established-relationship case. */
  lastConversationActivityMs: number | null;
  /** False inside the canonical Wave pair cooldown. */
  waveAvailable: boolean;
};

export type RelationshipFocus = {
  muddy: Pick<FocusCandidate, "id" | "displayName" | "avatarUrl">;
  plan: MuddyActionPlan;
  /**
   * Another Muddy nobody has spoken to yet, excluding the one above.
   *
   * EXISTING RELATIONSHIPS BEFORE MORE ACQUISITION. Somebody who added three
   * people and messaged one does not need to be told to invite a fourth --
   * two of their Muddies are still sitting there unspoken. Null when the
   * circle has no such person, which is when growing it is worth suggesting.
   */
  nextUnspokenMuddy: Pick<FocusCandidate, "id" | "displayName" | "avatarUrl"> | null;
  /**
   * Whether the canonical pair cooldown currently allows a Wave.
   *
   * Read from the same `waves` window the send action checks, so a surface
   * offering Wave is offering something the server will actually accept.
   */
  waveAvailable: boolean;
};

/**
 * Newest first, then id.
 *
 * The id tiebreak is not cosmetic: two friendships accepted in the same second
 * would otherwise depend on database row order, and the card would swap people
 * between refreshes for no reason a user could see.
 */
function newestFirst(a: FocusCandidate, b: FocusCandidate): number {
  if (b.connectedAtMs !== a.connectedAtMs) return b.connectedAtMs - a.connectedAtMs;
  return a.id.localeCompare(b.id);
}

function mostRecentlyActive(a: FocusCandidate, b: FocusCandidate): number {
  const at = a.lastConversationActivityMs ?? 0;
  const bt = b.lastConversationActivityMs ?? 0;
  if (bt !== at) return bt - at;
  return a.id.localeCompare(b.id);
}

/**
 * Pick the one relationship worth naming, or null when there is none.
 *
 * Priority, in the order a person would explain it:
 *
 *   1. A shared upcoming Plan. Something already arranged outranks anything
 *      the app could suggest.
 *   2. A new relationship nobody has spoken in yet. This is the gap activation
 *      exists to close, and it closes with one tap.
 *   3. The most recently active conversation. Ordinary, and never wrong.
 *   4. Newest connection, as a deterministic floor.
 *
 * Nearby is DELIBERATELY ABSENT from this ordering. When somebody is actually
 * around, NearbyHero owns that moment and this card is not on screen.
 */
export function selectRelationshipFocus(
  candidates: readonly FocusCandidate[]
): RelationshipFocus | null {
  if (candidates.length === 0) return null;

  const shared = [...candidates].filter((c) => c.hasSharedUpcomingPlan).sort(newestFirst);
  const unspoken = [...candidates].filter((c) => c.conversationState === "none").sort(newestFirst);
  const spoken = [...candidates]
    .filter((c) => c.conversationState !== "none")
    .sort(mostRecentlyActive);

  const chosen = shared[0] ?? unspoken[0] ?? spoken[0] ?? [...candidates].sort(newestFirst)[0];

  return {
    muddy: { id: chosen.id, displayName: chosen.displayName, avatarUrl: chosen.avatarUrl },
    /* The SAME engine every other surface uses. This module chooses WHO; it
     * does not get an opinion about what to offer, because a second answer to
     * that question is how two screens start disagreeing. */
    plan: planActionsForMuddy({
      hasSharedUpcomingPlan: chosen.hasSharedUpcomingPlan,
      hasExistingConversation: chosen.conversationState !== "none",
      conversationState: chosen.conversationState,
      // Not nearby by construction: this card only renders when nobody is.
      isNearby: false,
      waveAvailable: chosen.waveAvailable
    }),
    waveAvailable: chosen.waveAvailable,
    /* The runner-up, and never the hero.
     *
     * Home must not offer "Say hi to Ama" underneath a card already saying
     * "Say hi" to Ama -- one screen, two routes to the same tap. Excluding the
     * chosen person by id is what keeps the second slot additive. Same
     * newest-first ordering, so the pair is stable between renders. */
    nextUnspokenMuddy:
      unspoken
        .filter((c) => c.id !== chosen.id)
        .map((c) => ({ id: c.id, displayName: c.displayName, avatarUrl: c.avatarUrl }))[0] ?? null
  };
}
