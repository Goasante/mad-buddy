/**
 * Linkr Event Mode (Stage F, Part B).
 *
 * A TEMPORARY, PER-REQUEST CONTEXT. Not a setting, not a stored preference,
 * not a column. Audited first: Linkr has no persisted proximity preference to
 * begin with -- `proximityTier` ("close" | "near" | "far") is derived per
 * candidate per request from location confidence and distance. So Event Mode
 * cannot "change the user's normal proximity setting", because there is no
 * such setting to change. It is a filter carried in the URL for the duration
 * of one visit, and leaving the screen ends it.
 *
 * WHAT IT DOES NOT DO, and this is the whole point:
 *
 *  - It does not make the checked-in user discoverable. Checking in to an
 *    event has no effect on whether anyone can see you in Linkr; that is
 *    still decided entirely by canStrangerDiscoverUpFor -- discovery opt-in,
 *    live session, fresh location, viewer location, blocks, ghost mode,
 *    account restrictions, and only then proximity.
 *
 *  - It does not widen eligibility. Event Mode can only ever NARROW the set
 *    of people already eligible, which is why it is applied as a filter over
 *    the canonical result rather than as a parameter inside the gate.
 *
 *  - It does not expose the event's location, anyone's coordinates, or any
 *    attendee's movement. It carries an event id and a tier, nothing more.
 */

/** The tiers Linkr already computes. Event Mode adds none of its own. */
export type ProximityTier = "close" | "near" | "far";

/**
 * Event Mode opens at the tightest tier: someone who just checked in wants
 * the people in the room, not the people across the city. This is a starting
 * filter for the session, and the user can still widen it with the ordinary
 * Linkr controls -- doing so changes only this visit.
 */
export const EVENT_MODE_INITIAL_TIER: ProximityTier = "close";

export type EventModeContext = {
  eventId: string;
  initialTier: ProximityTier;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Reads Event Mode from URL params.
 *
 * Returns null for anything malformed rather than a partially-trusted
 * context: an unvalidated id would be passed to a query, and a context that
 * exists but names no real event would show a banner about nothing.
 */
export function readEventModeContext(params: {
  eventId?: string | null;
  eventMode?: string | null;
}): EventModeContext | null {
  if (params.eventMode !== "1") return null;
  const eventId = params.eventId?.trim();
  if (!eventId || !UUID_PATTERN.test(eventId)) return null;
  return { eventId, initialTier: EVENT_MODE_INITIAL_TIER };
}

/** The link that opens Linkr in Event Mode. One definition, so it stays valid. */
export function eventModeHref(eventId: string): string {
  return `/discover?eventMode=1&eventId=${encodeURIComponent(eventId)}`;
}

/**
 * Whether Event Mode may be entered at all.
 *
 * Requires a LIVE CHECK-IN, not merely an RSVP: "meet people at this event"
 * is a claim about being somewhere, and someone who has not arrived should
 * not be shown the room. Checked server-side against the check_ins row, never
 * from the URL -- otherwise anyone could hand-type the link.
 */
export function canEnterEventMode(input: {
  viewerCheckedIn: boolean;
  eventActive: boolean;
  accessDenied: boolean;
}): boolean {
  if (input.accessDenied) return false;
  if (!input.eventActive) return false;
  return input.viewerCheckedIn;
}

/**
 * Narrows an already-eligible candidate set to the current tier.
 *
 * Takes candidates that have ALREADY passed Linkr's own eligibility. This
 * function cannot add anyone: it only removes. That asymmetry is what makes
 * it safe to layer on top of the canonical gate rather than inside it.
 */
export function narrowToEventMode<T extends { proximityTier: ProximityTier }>(
  candidates: T[],
  tier: ProximityTier
): T[] {
  if (tier === "far") return candidates;
  if (tier === "near") return candidates.filter((c) => c.proximityTier !== "far");
  return candidates.filter((c) => c.proximityTier === "close");
}
