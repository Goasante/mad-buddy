/**
 * How much of Mad Buddy this person has actually met.
 *
 * FIRST VALUE IS NOT MATURITY. Home used to be binary: focused while
 * activating, then the entire dashboard the instant `hasReachedFirstValue`
 * turned true. Sending one message therefore unlocked Trending, a Journey
 * campaign, three feature tiles and two profile prompts at once -- the product
 * answering somebody's first hello by showing them a catalogue.
 *
 * Home should prioritise the person's current social context and next
 * meaningful action, not enumerate every capability that exists. So maturity
 * has three steps, and the middle one is where most new people actually live.
 *
 * DERIVED, NEVER STORED. Same reasoning as activation: a saved cursor drifts
 * the moment reality disagrees with it, and a migrated account that never saw
 * the new onboarding would be stranded at step one forever. Every input below
 * is a question about the account as it is.
 *
 * NO SCORE. No points, no weights, no ranking. Each step is a stated rule a
 * person could read back and argue with, which is the property a hidden number
 * cannot have.
 */

export type HomeMaturity =
  /** Still being taught the core loop. Home stays focused. */
  | "activating"
  /** Has done something real, but has not shown broad use. Opens gradually. */
  | "early_value"
  /** Uses Mad Buddy. Home adapts rather than teaches. */
  | "established";

export type HomeMaturityInputs = {
  /** Milestones this account has ever reached. */
  milestones: ReadonlySet<string>;
  /** Direct conversations where BOTH people have written. */
  twoSidedConversationCount: number;
  /** Plans this person is on, past or upcoming. Evidence of real use. */
  planParticipationCount: number;
  /** Live, mutual Muddies. Supporting evidence only, never sufficient alone. */
  muddyCount: number;
};

/**
 * Has this person reached genuine first value?
 *
 * Kept identical to activation's own definition rather than restated, so the
 * two cannot drift into disagreeing about whether somebody has arrived.
 */
function reachedFirstValue(milestones: ReadonlySet<string>): boolean {
  if (!milestones.has("first_muddy_added")) return false;
  return (
    milestones.has("first_wave_sent") ||
    milestones.has("first_message_sent") ||
    milestones.has("first_plan_created") ||
    milestones.has("first_status_created")
  );
}

/**
 * Evidence that somebody actually uses Mad Buddy, not just that they arrived.
 *
 * EACH SIGNAL IS A COMPLETED LOOP, not a count of activity:
 *
 *   - A two-sided conversation means somebody replied. One person talking into
 *     silence is not a relationship yet, however many messages they send.
 *   - A Plan is the product's whole point: an arrangement to actually meet.
 *   - A Wave plus a real conversation is proximity AND contact, which is the
 *     loop working end to end.
 *
 * DELIBERATELY NOT SUFFICIENT: Muddy count (a big list is not usage), profile
 * completion (setup, not value), and `first_status_created` alone (broadcast
 * rather than interaction -- already flagged as a taxonomy concern, and it
 * must not quietly become proof of maturity here).
 */
function looksEstablished(input: HomeMaturityInputs): boolean {
  if (input.planParticipationCount > 0) return true;
  if (input.twoSidedConversationCount > 0) return true;
  return input.milestones.has("first_wave_sent") && input.twoSidedConversationCount > 0;
}

export function deriveHomeMaturity(input: HomeMaturityInputs): HomeMaturity {
  /* HISTORICAL ACCOUNTS FIRST, and deliberately before the milestone check.
   *
   * Somebody who has been here for months has plans and replied-to
   * conversations but may have no `first_message_sent` at all -- the milestone
   * only exists from the day it was added. Requiring it would re-onboard the
   * product's most experienced users, which is exactly what the future
   * Experience Migration must not do. Real activity is backward-compatible;
   * milestone keys are not. */
  if (looksEstablished(input)) return "established";

  if (!reachedFirstValue(input.milestones)) return "activating";

  return "early_value";
}
