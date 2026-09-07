import {
  blockedByRule,
  fixed,
  notApplicable,
  type RepairVerification,
  stillBroken
} from "@/lib/admin/repair-verification";

/**
 * EVENTS and SAFE ARRIVAL diagnostics.
 *
 * These two sit together because they share the hardest constraint in Admin:
 * the diagnostic must be useful to Support while carrying almost none of the
 * underlying data.
 *
 * SAFE ARRIVAL IS THE STRICTEST SURFACE IN THE PRODUCT. A journey record says
 * where somebody went, when, how long they expected to take, and who was
 * watching. Support does not need any of that to answer "why is my check-in
 * stuck" -- it needs the lifecycle state and nothing else. So the view below
 * deliberately has no destination, no label, no coordinates, no route, no
 * timings beyond whether a deadline has passed, and no watcher identities.
 * There is no repair here that reveals a journey; the only actions are ones the
 * traveller could have taken themselves.
 *
 * The functions are pure, so what they can see is exactly what they are given,
 * and a future edit cannot quietly widen it.
 */

export type EventStatus = "draft" | "scheduled" | "active" | "ended" | "cancelled";
export type EventRsvp = "interested" | "going" | "not_going";

export type EventParticipationView = {
  eventId: string;
  eventStatus: EventStatus;
  /** This account's RSVP, or null when they have not answered. */
  rsvp: EventRsvp | null;
  /** An Event Chat / circle exists for this event. */
  circleExists: boolean;
  /** This account is a joined member of it. */
  joinedCircle: boolean;
  /** The event requires an invitation to attend. */
  inviteOnly: boolean;
  /** This account holds an invitation. */
  invited: boolean;
};

/**
 * Safe Arrival lifecycle, WITHOUT the journey.
 *
 * Every field here is a state or a count. Nothing identifies where the person
 * went or who is watching them.
 */
export type SafeArrivalView = {
  sessionId: string;
  status:
    | "draft"
    | "pending_acknowledgement"
    | "active"
    | "grace_period"
    | "extended"
    | "completed"
    | "cancelled"
    | "expired"
    | "unconfirmed";
  /** Expected arrival is in the past. A boolean, never the time itself. */
  pastExpectedArrival: boolean;
  /** Grace period has also elapsed. */
  pastGracePeriod: boolean;
  /** How many people agreed to watch. A count, never who they are. */
  acknowledgedWatcherCount: number;
  /** How many were asked but have not answered. */
  pendingWatcherCount: number;
};

export type LifecycleFinding = {
  id: string;
  repairable: boolean;
  explanation: string;
};

const LIVE_SAFE_ARRIVAL = [
  "draft",
  "pending_acknowledgement",
  "active",
  "grace_period",
  "extended",
  "unconfirmed"
] as const;

export function isSafeArrivalLive(status: SafeArrivalView["status"]): boolean {
  return (LIVE_SAFE_ARRIVAL as readonly string[]).includes(status);
}

/**
 * A journey that is overdue and waiting on the canonical safety sweep.
 *
 * NOT REPAIRABLE BY ADMIN, and the reason is the whole point of this module.
 * `process_due_safe_arrivals` moves an overdue live journey to `unconfirmed`,
 * writes an `unconfirmed_alert` and NOTIFIES THE WATCHERS; only 12 further
 * hours unresolved make it `expired`. An Admin repair that wrote `expired`
 * directly -- which an earlier version of this tranche did -- would skip the
 * alert entirely, tidying the record of somebody who may never have arrived.
 *
 * So this reports a state for a HUMAN to escalate: it means the sweep has not
 * run, which is an ops problem, not account drift.
 *
 * `unconfirmed` is excluded for the adjacent reason: there the watchers have
 * already been told, and closing it would erase a signal somebody may still be
 * acting on.
 */
export function findStalledSafeArrival(sessions: readonly SafeArrivalView[]): LifecycleFinding[] {
  return sessions
    .filter(
      (session) =>
        session.pastGracePeriod &&
        (session.status === "active" || session.status === "extended" || session.status === "grace_period")
    )
    .map((session) => ({
      id: session.sessionId,
      repairable: false,
      explanation:
        "This journey is past its arrival time and grace period but still marked live, which means the canonical safety sweep has not processed it. Escalate: the sweep moves it to unconfirmed and alerts the watchers, and Admin must not do that itself."
    }));
}

/**
 * What Support may say about a Safe Arrival session.
 *
 * Note the shape of every message: it describes STATE, never the journey. An
 * operator reading these out loud cannot accidentally tell somebody where
 * another person went.
 */
export function explainSafeArrival(session: SafeArrivalView): RepairVerification {
  const invariant = "the Safe Arrival session reflects the traveller's real state";

  if (session.status === "unconfirmed") {
    return blockedByRule(
      invariant,
      "An unconfirmed arrival is a safety signal, not a stuck record",
      "This journey ended without the traveller confirming arrival, and their watchers were told. Admin must not close it — if there is any doubt about the person, escalate rather than tidy the record."
    );
  }

  if (session.status === "completed" || session.status === "cancelled" || session.status === "expired") {
    return notApplicable(
      invariant,
      `This journey is already ${session.status}. There is nothing live to repair.`
    );
  }

  if (session.status === "pending_acknowledgement" && session.acknowledgedWatcherCount === 0) {
    return blockedByRule(
      invariant,
      "Watchers choose whether to accept; nobody can be made to watch",
      "Nobody has accepted the request to watch this journey yet. Admin cannot accept on their behalf — the traveller can ask someone else."
    );
  }

  if (session.pastGracePeriod && isSafeArrivalLive(session.status)) {
    return stillBroken(
      invariant,
      "This journey is past its arrival time and grace period but still marked live."
    );
  }

  return fixed(invariant, "This journey's state matches its timing, so nothing needs repairing.");
}

/**
 * Why this account cannot reach an Event's chat.
 *
 * Same precedence discipline as Plans: name the reason that actually governs,
 * so the operator does not send somebody to do something that changes nothing.
 */
export function explainEventAccess(view: EventParticipationView): RepairVerification {
  const invariant = "the account is a joined member of the Event circle";

  if (view.eventStatus === "cancelled" || view.eventStatus === "ended") {
    return blockedByRule(
      invariant,
      "A finished or cancelled Event keeps its circle closed",
      `This Event is ${view.eventStatus}, so its circle is not reopening.`
    );
  }

  if (view.inviteOnly && !view.invited) {
    return blockedByRule(
      invariant,
      "An invite-only Event admits only invited people",
      "This Event is invite-only and this account has no invitation. Only the host can invite them — Admin must not."
    );
  }

  if (view.rsvp === "not_going") {
    return blockedByRule(
      invariant,
      "Event circle membership follows the RSVP",
      "This account answered no to the Event, so it is not in the circle. Changing that answer is theirs to do."
    );
  }

  if (view.rsvp === null || view.rsvp === "interested") {
    return blockedByRule(
      invariant,
      "The Event circle is for people who are going",
      "This account has not said they are going, so they are not in the circle yet."
    );
  }

  if (!view.circleExists) {
    return notApplicable(
      invariant,
      "This Event has no circle yet, so there is nothing to join."
    );
  }

  if (!view.joinedCircle) {
    return stillBroken(
      invariant,
      "This account is going to the Event and the circle exists, but they are not a joined member."
    );
  }

  return fixed(invariant, "This account is a joined member of the Event circle, as expected.");
}

/**
 * Verifier for closing a stalled journey.
 *
 * NOT WIRED TO A REPAIR, and must not be. An earlier version of this tranche
 * shipped `close_stalled_safe_arrival`, which took an overdue
 * active/grace_period/extended journey straight to `expired`. That is NOT what
 * the canonical lifecycle does.
 *
 * `process_due_safe_arrivals` moves an overdue live journey to `unconfirmed`,
 * writes an `unconfirmed_alert` event and NOTIFIES THE WATCHERS. Only after a
 * further 12 hours unresolved does it become `expired`. So the repair skipped
 * the exact escalation Safe Arrival exists to provide: a person who never
 * arrived would have had their record tidied instead of their watchers told.
 *
 * Overdue live journeys are therefore DIAGNOSTIC AND ESCALATION ONLY. Admin
 * must not reproduce the lifecycle, and must not call the global due-worker
 * either -- that is a system-wide sweep, and an account repair has to stay
 * scoped to the account in front of the operator.
 *
 * Kept for the day a target-scoped canonical RPC exists. It claims the record
 * is consistent -- NOT that the person is safe. Admin has no way to know the
 * second thing, and a verifier that implied it would be the most dangerous
 * sentence in this whole system.
 */
export function verifySafeArrivalClosure(input: {
  attempted: number;
  stillLive: number;
}): RepairVerification {
  const invariant = "no Safe Arrival session is marked live past its grace period";

  if (input.attempted === 0) {
    return notApplicable(invariant, "This account has no journeys stalled past their grace period.");
  }
  if (input.stillLive > 0) {
    return stillBroken(
      invariant,
      `${input.stillLive} journey${input.stillLive === 1 ? " is" : "s are"} still marked live after the repair.`
    );
  }
  return fixed(
    invariant,
    `${input.attempted} finished journey${input.attempted === 1 ? "" : "s"} closed. This corrects the record only — it says nothing about whether the person arrived safely, and no watcher alert was withdrawn.`
  );
}
