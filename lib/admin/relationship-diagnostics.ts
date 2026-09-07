import {
  blockedByRule,
  fixed,
  notApplicable,
  type RepairVerification,
  stillBroken
} from "@/lib/admin/repair-verification";

/**
 * MUDDIES / FRIEND REQUESTS and BLOCKS / RE-FRIEND diagnostics.
 *
 * These are the two areas where Support is most likely to be asked to do
 * something it must not do, so the boundary is drawn here rather than in the
 * UI: Admin never creates a friendship, never withdraws somebody else's block,
 * and never accepts a request on a user's behalf. Consent is the product.
 *
 * What Admin CAN do is repair the bookkeeping around consent -- a request row
 * that outlived the decision it recorded. Those are real: migration
 * 20260719120000 had to repair two classes of them in bulk, which is the
 * evidence that they occur in production rather than only in theory.
 *
 * The functions here are PURE. They take an already-gathered, privacy-minimised
 * view of the relationship rows and decide what is drift, what is a product
 * rule, and what needs escalating -- so the decisions can be tested without a
 * database and cannot quietly read anything they were not given.
 */

/** One pair, from the perspective of the account being diagnosed. */
export type RelationshipPair = {
  /** The other person. Ids only -- no names, avatars or profile data. */
  otherUserId: string;
  /** A friendship row exists and has not ended. */
  friendshipLive: boolean;
  /** A friendship row exists at all (live or ended). */
  friendshipRowExists: boolean;
  /** This account blocks them. */
  blocksThem: boolean;
  /** They block this account. */
  blockedByThem: boolean;
  /** A pending friend_requests row exists for the pair, in either direction. */
  pendingRequest: boolean;
  /**
   * Pending requests in BOTH directions -- two rows recording one intention
   * each. Explicit rather than inferred from a missing direction, so "we don't
   * know who asked" can never be mistaken for "they both asked".
   */
  pendingBothDirections?: boolean;
};

export type RelationshipIssueKind =
  /** Pending request for a pair who are already Muddies. Bookkeeping drift. */
  | "pending_request_while_friends"
  /** Pending request that a block should have settled. Bookkeeping drift. */
  | "pending_request_while_blocked"
  /** Requests pending in BOTH directions. One decision, two rows. */
  | "reciprocal_pending_requests";

export type RelationshipIssue = {
  kind: RelationshipIssueKind;
  otherUserId: string;
  /** Whether Admin may act, or whether this is a rule to explain instead. */
  repairable: boolean;
  explanation: string;
};

/**
 * A live block in EITHER direction. The asymmetry matters: the person who was
 * blocked cannot see that they were, so Support must never say who blocked
 * whom -- only that the pair is blocked and the product is refusing.
 */
export function isBlockedEitherWay(pair: RelationshipPair): boolean {
  return pair.blocksThem || pair.blockedByThem;
}

/**
 * The drift Admin may repair, and the states it may not touch.
 *
 * Note what is deliberately NOT an issue:
 *   - an ended friendship with no pending request. That is two people who are
 *     no longer Muddies, which is a normal outcome, not damage.
 *   - a pending request between strangers. That is the product working.
 *   - a block with no request. That is somebody's decision, fully applied.
 */
export function findRelationshipIssues(pairs: readonly RelationshipPair[]): RelationshipIssue[] {
  const issues: RelationshipIssue[] = [];

  for (const pair of pairs) {
    if (!pair.pendingRequest) continue;

    if (isBlockedEitherWay(pair)) {
      /* REPAIRABLE, and safe: settling the row does not lift the block, does
         not reveal who blocked whom, and does not create any permission. It
         removes a request the product will refuse anyway, which is what stops
         the pair being offered to each other again. */
      issues.push({
        kind: "pending_request_while_blocked",
        otherUserId: pair.otherUserId,
        repairable: true,
        explanation:
          "A Muddy request is still pending for a pair with a live block. The block already refuses it; settling the row stops it being re-offered."
      });
      continue;
    }

    if (pair.friendshipLive) {
      /* LEGACY ONLY. `friend_requests_prevent_existing_friendship` raises
         `users_are_already_friends` on any new pending row for a live pair, so
         this state cannot be created any more -- it exists only in rows that
         predate that trigger. Kept because those rows are real and nothing
         else will clear them, and because a diagnostic that silently stopped
         looking would leave them stranded forever. */
      issues.push({
        kind: "pending_request_while_friends",
        otherUserId: pair.otherUserId,
        repairable: true,
        explanation:
          "A Muddy request is still pending for a pair who are already Muddies. The relationship is correct; only the request row is stale, and it predates the database guard that now prevents this."
      });
    }
  }

  return issues;
}

/**
 * Reciprocal pending requests: both people asked, neither answered.
 *
 * NOT repairable, deliberately. Two people each made a real choice to ask, and
 * settling either row silently is Admin answering on somebody's behalf. Either
 * of them accepting resolves it correctly in one tap, which is what Support
 * should tell them to do.
 */
export function findReciprocalRequests(pairs: readonly RelationshipPair[]): RelationshipIssue[] {
  return pairs
    .filter((pair) => pair.pendingRequest && pair.pendingBothDirections === true)
    .map((pair) => ({
      kind: "reciprocal_pending_requests" as const,
      otherUserId: pair.otherUserId,
      repairable: false,
      explanation:
        "Both people have an open Muddy request to each other. Either accepting resolves it; Admin must not answer for either of them."
    }));
}

/**
 * Why a pair cannot message, in the user's terms.
 *
 * The order is the product's own precedence, and getting it wrong is how a
 * support tool starts lying: a blocked pair who are also not Muddies must be
 * explained as BLOCKED, because lifting the block is the only thing that
 * changes anything, and "you're not Muddies" would send them to re-add
 * somebody who has blocked them.
 */
export function explainMessagingEligibility(pair: RelationshipPair): RepairVerification {
  const invariant = "the pair may hold a direct conversation";

  if (isBlockedEitherWay(pair)) {
    return blockedByRule(
      invariant,
      "A live block outranks friendship, in either direction",
      "These two cannot message because a block is in place. Only the person who set it can lift it — Admin must not, and must not say who set it."
    );
  }

  if (!pair.friendshipLive) {
    return blockedByRule(
      invariant,
      "Direct messaging requires a current Muddy relationship or an active Linkr connection",
      pair.friendshipRowExists
        ? "These two were Muddies and no longer are. They can become Muddies again through a normal request — Admin must not recreate the relationship."
        : "These two have never been Muddies, so direct messaging is not available to them yet."
    );
  }

  return fixed(invariant, "The pair are current Muddies with no block, so direct messaging is permitted.");
}

/**
 * Verifier for settling stale request rows.
 *
 * The invariant is deliberately narrow: the stale ROWS are gone. It says
 * nothing about friendship or blocks, because the repair changes neither, and
 * a verifier that claimed more than its repair did would be the same lie in a
 * different place.
 */
export function verifyRequestSettlement(input: {
  attempted: number;
  remainingPending: number;
  blockedPairsRemaining: number;
}): RepairVerification {
  const invariant = "no stale pending Muddy request remains for a settled or blocked pair";

  if (input.attempted === 0) {
    return notApplicable(invariant, "There were no stale Muddy requests on this account.");
  }

  if (input.remainingPending > 0) {
    return stillBroken(
      invariant,
      `${input.remainingPending} stale request${input.remainingPending === 1 ? "" : "s"} could not be settled.`
    );
  }

  const blockNote =
    input.blockedPairsRemaining > 0
      ? ` ${input.blockedPairsRemaining} pair${input.blockedPairsRemaining === 1 ? " remains" : "s remain"} blocked, which is correct and unchanged.`
      : "";

  return fixed(
    invariant,
    `${input.attempted} stale Muddy request${input.attempted === 1 ? "" : "s"} settled. No friendship or block was created, changed or removed.${blockNote}`
  );
}
