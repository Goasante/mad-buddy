import type { EventParticipationView } from "@/lib/admin/event-safety-diagnostics";

/**
 * The Event facts the live Doctor reads, as one shared projection.
 *
 * This exists because the local test used to build its own view by hand. Both
 * were correct, and that is precisely the problem: a test that reproduces the
 * loader's logic proves the logic it reproduced, not the logic that ships. If
 * the loader started filtering RSVPs -- which it did -- the hand-built version
 * kept passing.
 *
 * So the loader and the test now call THIS, and the only way for them to
 * disagree is for one of them to stop using it.
 */

export type EventFactRows = {
  events: readonly { id: string; status: string; visibility: string }[];
  /* `event_id` is nullable in the schema. A circle with no event cannot belong
     to one of these Events, so it is dropped rather than coerced. */
  circles: readonly { id: string; event_id: string | null }[];
  /** RSVPs for the diagnosed account, in EVERY state. */
  rsvps: readonly { event_id: string; status: string }[];
  /** Circle ids this account is a joined member of. */
  joinedCircleIds: ReadonlySet<string>;
  /** Circle ids this account holds an invitation to. */
  invitedCircleIds: ReadonlySet<string>;
};

/**
 * `invite` is the only visibility that genuinely requires an invitation.
 * Treating link/community/nearby/public as invite-only would invent a refusal
 * the product does not make.
 */
export function requiresInvitation(visibility: string): boolean {
  return visibility === "invite";
}

/** One view per Event the account has responded to, ready for the authority. */
export function projectEventViews(rows: EventFactRows): EventParticipationView[] {
  const circleByEvent = new Map(
    rows.circles
      .filter((circle): circle is { id: string; event_id: string } => Boolean(circle.event_id))
      .map((circle) => [circle.event_id, circle.id])
  );
  const rsvpByEvent = new Map(rows.rsvps.map((rsvp) => [rsvp.event_id, rsvp.status]));

  return rows.events.map((event) => {
    const circleId = circleByEvent.get(event.id);
    return {
      eventId: event.id,
      eventStatus: event.status as EventParticipationView["eventStatus"],
      rsvp: (rsvpByEvent.get(event.id) ?? null) as EventParticipationView["rsvp"],
      circleExists: Boolean(circleId),
      joinedCircle: Boolean(circleId) && rows.joinedCircleIds.has(circleId!),
      inviteOnly: requiresInvitation(event.visibility),
      invited: Boolean(circleId) && rows.invitedCircleIds.has(circleId!)
    };
  });
}
