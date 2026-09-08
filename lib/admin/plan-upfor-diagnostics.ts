import {
  blockedByRule,
  fixed,
  notApplicable,
  type RepairVerification,
  stillBroken
} from "@/lib/admin/repair-verification";

/**
 * PLANS and UPFOR diagnostics.
 *
 * Support meets these areas as one sentence -- "I can't join", "my UpFor won't
 * convert", "it says I'm going but there's no chat" -- and the honest answer is
 * usually a product rule rather than damage. The canonical lifecycle raises
 * fourteen distinct refusals (PLAN_CLOSED, PLAN_RSVP_DEADLINE_PASSED,
 * PLAN_PARTICIPANT_INELIGIBLE, HANGOUT_NOT_CONVERTIBLE and the rest), and every
 * one of them is the product working. Reading them as faults is how a support
 * tool starts forcing people into Plans they were legitimately kept out of.
 *
 * So the job here is mostly TRANSLATION: turn a lifecycle refusal into a
 * sentence an operator can say out loud, and separate the small number of real
 * drift states from the large number of correct ones.
 *
 * Pure functions over an already-gathered, privacy-minimised view: no titles,
 * no descriptions, no places, no message content, no attendee lists. Ids and
 * lifecycle state only.
 */

/** UpFor session lifecycle, as the database defines it. */
export type UpForStatus = "draft" | "active" | "paused" | "full" | "expired" | "cancelled" | "converted_to_plan";

/** Plan lifecycle, as the database defines it. */
export type PlanStatus = "draft" | "inviting" | "polling" | "confirmed" | "cancelled" | "completed" | "expired";

export type UpForSessionView = {
  sessionId: string;
  status: UpForStatus;
  /** Session end time, ISO. Null when open-ended. */
  endsAt: string | null;
  /** Accepted requests on this session. */
  acceptedCount: number;
  /** Requests still awaiting the owner's answer. */
  pendingCount: number;
  maxParticipants: number | null;
  /** A Plan was produced from this session. */
  convertedPlanId: string | null;
};

export type PlanParticipationView = {
  planId: string;
  planStatus: PlanStatus;
  /** This account's RSVP on the Plan. */
  rsvpStatus: "invited" | "viewed" | "going" | "maybe" | "not_going" | "removed";
  /** A Plan Chat exists for the Plan. */
  conversationExists: boolean;
  /** This account is a joined member of that chat. */
  joinedConversation: boolean;
  /** The Plan came from an UpFor session. */
  sourceHangoutId: string | null;
  /** This account has an accepted request on that source session. */
  acceptedOnSourceHangout: boolean;
  /** This account and the Plan's creator are current Muddies. */
  muddyWithCreator: boolean;
  /** A live block stands between this account and the Plan's creator. */
  blockedWithCreator: boolean;
};

export type LifecycleFinding = {
  id: string;
  /** Whether Admin may act, or whether this is a rule to explain. */
  repairable: boolean;
  explanation: string;
};

const OPEN_PLAN_STATUSES: readonly PlanStatus[] = ["draft", "inviting", "polling", "confirmed"];

export function isPlanOpen(status: PlanStatus): boolean {
  return OPEN_PLAN_STATUSES.includes(status);
}

/**
 * An UpFor that has run past its own end time but still says it is live.
 *
 * REAL DRIFT. Expiry is time-driven, so a session whose sweep did not run keeps
 * appearing in discovery and keeps accepting requests for something that is
 * over. `paused` is excluded deliberately: the owner chose that, and a paused
 * session sitting past its end time is a person who stopped, not a stuck row.
 */
export function findStaleUpForSessions(sessions: readonly UpForSessionView[], now: Date): LifecycleFinding[] {
  return sessions
    .filter((session) => {
      if (session.status !== "active" && session.status !== "full") return false;
      if (!session.endsAt) return false;
      const ends = Date.parse(session.endsAt);
      return Number.isFinite(ends) && ends < now.getTime();
    })
    .map((session) => ({
      id: session.sessionId,
      repairable: true,
      explanation:
        "This UpFor is past its end time but still marked live, so it keeps appearing and accepting requests for something that is over."
    }));
}

/**
 * Requests left waiting on an UpFor that can no longer accept anyone.
 *
 * REAL DRIFT, and the one people actually feel: a person who asked to join sees
 * "waiting" forever for a session that is cancelled, expired or already
 * converted. Settling those requests grants nobody anything -- it ends a wait
 * the product has already decided.
 */
export function findStrandedRequests(sessions: readonly UpForSessionView[]): LifecycleFinding[] {
  const closed: readonly UpForStatus[] = ["expired", "cancelled", "converted_to_plan"];
  return sessions
    .filter((session) => session.pendingCount > 0 && closed.includes(session.status))
    .map((session) => ({
      id: session.sessionId,
      repairable: true,
      explanation: `${session.pendingCount} request${session.pendingCount === 1 ? " is" : "s are"} still waiting on an UpFor that is ${session.status.replace(/_/g, " ")}. They will never be answered as they stand.`
    }));
}

/**
 * A full session is NOT a fault.
 *
 * Support will be asked to "let one more person in". Capacity is the owner's
 * choice and the product enforces it; Admin raising it would override a real
 * decision by a real person, so this is an explanation, never a repair.
 */
export function explainCapacity(session: UpForSessionView): RepairVerification {
  const invariant = "the UpFor has room for another participant";

  if (session.status === "full" || (session.maxParticipants !== null && session.acceptedCount >= session.maxParticipants)) {
    return blockedByRule(
      invariant,
      "UpFor capacity is set by the person who created it",
      "This UpFor is full. Only its owner can make room — by raising the limit or by declining someone — and Admin must not do either for them."
    );
  }

  return fixed(invariant, "This UpFor still has room, so capacity is not what is stopping anyone joining.");
}

/**
 * Why this account cannot reach a Plan Chat.
 *
 * The precedence is the lifecycle's own, and the order matters as much as it
 * did for blocks: a removed participant who is also not a Muddy must be told
 * they were REMOVED, because re-adding the friendship changes nothing and
 * sending them to do it wastes everybody's time.
 */
export function explainPlanChatAccess(view: PlanParticipationView): RepairVerification {
  const invariant = "the account is a joined member of the Plan Chat";

  if (view.blockedWithCreator) {
    return blockedByRule(
      invariant,
      "A live block outranks Plan participation, in either direction",
      "A block stands between this account and the Plan's host, so no Plan Chat membership is possible while it does."
    );
  }

  if (view.rsvpStatus === "removed") {
    return blockedByRule(
      invariant,
      "A removed participant stays removed until the host re-invites them",
      "This account was removed from the Plan. Only the host can invite them back — Admin must not re-add them, and re-adding the friendship would change nothing."
    );
  }

  if (view.rsvpStatus === "not_going") {
    return blockedByRule(
      invariant,
      "Plan Chat membership follows the RSVP",
      "This account answered no to the Plan, so it is not in the chat. Changing their answer is theirs to do."
    );
  }

  if (!isPlanOpen(view.planStatus)) {
    return blockedByRule(
      invariant,
      "A finished or cancelled Plan keeps its chat closed",
      `This Plan is ${view.planStatus}, so its chat is not reopening. That is the Plan ending, not a fault.`
    );
  }

  /* ELIGIBILITY, POST-20260907120000. A contextual participant -- accepted onto
     the source UpFor without being a Muddy -- is now legitimate, so "not a
     Muddy" is only a reason when there is no accepted request either. Reading
     this the old way would tell a valid participant they need a friendship
     they do not need. */
  if (!view.muddyWithCreator && !(view.sourceHangoutId && view.acceptedOnSourceHangout)) {
    return blockedByRule(
      invariant,
      "Plan participation requires a Muddy relationship, or an accepted request on the Plan's own source UpFor",
      "This account is neither a Muddy of the host nor an accepted participant of the UpFor this Plan came from, so it is not eligible for the chat."
    );
  }

  if (!view.conversationExists) {
    return notApplicable(
      invariant,
      "This Plan has no chat yet. One is created by the Plan lifecycle when it is needed, so there is nothing to join."
    );
  }

  if (!view.joinedConversation) {
    return stillBroken(
      invariant,
      "This account is eligible for the Plan Chat and the chat exists, but they are not a joined member. Reconciliation should fix this."
    );
  }

  return fixed(invariant, "This account is a joined member of the Plan Chat, as expected.");
}

/**
 * Verifier for settling stranded UpFor requests.
 *
 * Narrow on purpose: it claims the WAIT ended, not that anybody got in.
 */
export function verifyRequestsSettled(input: {
  attempted: number;
  remainingPending: number;
}): RepairVerification {
  const invariant = "no request is left pending on a closed UpFor";

  if (input.attempted === 0) {
    return notApplicable(invariant, "No requests were stranded on closed UpFors.");
  }
  if (input.remainingPending > 0) {
    return stillBroken(
      invariant,
      `${input.remainingPending} request${input.remainingPending === 1 ? " is" : "s are"} still pending on a closed UpFor.`
    );
  }
  return fixed(
    invariant,
    `${input.attempted} stranded request${input.attempted === 1 ? "" : "s"} settled. Nobody was added to anything — the requests were closed, not granted.`
  );
}

/**
 * Verifier for expiring a stale UpFor.
 *
 * Note what it does NOT claim: nothing about the Plan the session might have
 * become, or about anyone's accepted request. Expiring a finished session ends
 * its visibility, and the verifier says only that.
 */
export function verifyUpForExpiry(input: {
  attempted: number;
  stillLive: number;
}): RepairVerification {
  const invariant = "no UpFor is marked live past its own end time";

  if (input.attempted === 0) {
    return notApplicable(invariant, "This account has no UpFor sessions running past their end time.");
  }
  if (input.stillLive > 0) {
    return stillBroken(
      invariant,
      `${input.stillLive} session${input.stillLive === 1 ? " is" : "s are"} still marked live after the repair.`
    );
  }
  return fixed(
    invariant,
    `${input.attempted} finished UpFor${input.attempted === 1 ? "" : "s"} closed. They stop appearing in discovery; existing Plans and accepted participants are untouched.`
  );
}
