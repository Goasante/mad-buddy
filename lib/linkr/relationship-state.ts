/**
 * The Linkr relationship state between a viewer and one other person.
 *
 * DERIVED, NEVER STORED. Every state below is a reading of rows that already
 * exist -- `linkr_actions` for what the viewer decided, `linkr_connections`
 * for whether both decided the same thing, plus blocks and eligibility. There
 * is deliberately no `state` column and no second action table: a stored copy
 * would be a second authority that could disagree with the rows it was copied
 * from, and disagreement about "are we connected" is exactly the bug this
 * product cannot have.
 *
 * WHAT THIS MODULE MAY NOT SEE. It reads only the VIEWER's own actions. The
 * other person's row is never an input, because a function that could see it
 * would eventually be asked to render it -- and "they haven't clicked you" is
 * the one sentence Linkr must never say. Reciprocity is resolved exclusively
 * by `linkr_record_connect`, which hands back a single bit.
 */

/** The viewer's relationship to one candidate. */
export type LinkrRelationshipState =
  /** Never decided about, and eligible to appear. */
  | "UNSEEN"
  /** The viewer passed; suppressed until the pass lapses. */
  | "PASSED"
  /** The viewer connected; private, and not yet returned. */
  | "PENDING_CONNECT"
  /** Both chose each other. The only state that grants Say hi. */
  | "MUTUAL_CLICKED"
  /** A block either direction, or an eligibility failure. Overrides all. */
  | "BLOCKED_OR_INELIGIBLE";

export type ViewerAction = {
  /** What the viewer decided. */
  action: "pass" | "connect";
  /** When the suppression lapses. NULL means "until I say otherwise". */
  expiresAt: string | null;
  /** When the decision was recorded. */
  createdAt: string;
};

export type RelationshipInput = {
  /** The viewer's own row, if they have decided about this person. */
  viewerAction: ViewerAction | null;
  /** An active (not ended) connection between the pair. */
  hasActiveConnection: boolean;
  /** A block in EITHER direction. */
  blockedEitherDirection: boolean;
  /** Everything the discovery rules require of the other person. */
  otherEligible: boolean;
  /** Evaluation time, injected so cooldowns are testable without waiting. */
  now: number;
};

/**
 * Resolve the state.
 *
 * ORDER IS THE SAFETY PROPERTY. Blocks and eligibility are checked before
 * anything else, so no amount of prior history can resurrect somebody who is
 * now blocked or ineligible -- including a pair who already connected. A
 * mutual connection is a reason to keep someone reachable, never a reason to
 * override a block placed afterwards.
 */
export function resolveRelationshipState(input: RelationshipInput): LinkrRelationshipState {
  if (input.blockedEitherDirection) return "BLOCKED_OR_INELIGIBLE";

  // A formed connection is checked before eligibility so that an existing
  // relationship is not silently reclassified as a discovery candidate when
  // the other person merely turns Linkr off. It still loses to a block above.
  if (input.hasActiveConnection) return "MUTUAL_CLICKED";

  if (!input.otherEligible) return "BLOCKED_OR_INELIGIBLE";

  const decided = input.viewerAction;
  if (!decided) return "UNSEEN";

  if (decided.action === "connect") return "PENDING_CONNECT";

  // A pass that has lapsed stops suppressing: the person becomes discoverable
  // again rather than being erased forever by one swipe.
  if (decided.expiresAt !== null && Date.parse(decided.expiresAt) <= input.now) {
    return "UNSEEN";
  }
  return "PASSED";
}

/** Whether this state belongs in the ordinary Discover deck. */
export function appearsInDiscover(state: LinkrRelationshipState): boolean {
  return state === "UNSEEN";
}

/**
 * How long a pending, unreturned interest waits before the viewer may be asked
 * about it again. Matches the pass cooldown so Linkr has ONE recycling period
 * rather than two numbers that drift apart.
 */
export const PENDING_RESURFACE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Whether a pending interest may be re-offered as "Still interested?".
 *
 * NOT a new discovery: the person is re-offered in an explicit reaffirm state,
 * because returning them to the deck as though they were new would be a lie
 * the viewer can detect and would quietly invite a second notification.
 *
 * Reaffirming notifies nobody, writes no new row, and changes no ranking -- so
 * this predicate governs presentation only.
 */
export function canResurfacePending(input: {
  state: LinkrRelationshipState;
  decidedAt: string;
  now: number;
}): boolean {
  if (input.state !== "PENDING_CONNECT") return false;
  const age = input.now - Date.parse(input.decidedAt);
  return Number.isFinite(age) && age >= PENDING_RESURFACE_MS;
}
