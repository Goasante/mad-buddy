/**
 * Event arrival (Stage F, Part B).
 *
 * PURE. Decides whether to show the in-app "Are you here?" state, and nothing
 * else -- no notification is sent from this stage.
 *
 * WHY NO NEW PUSH. Stage D already sends three reminders: 24h, 2h, and
 * near_start at 30 minutes. Adding a start-time push and a check-in push on
 * top would mean up to five notifications about one event, three of them
 * inside the last half hour, all saying approximately the same thing. The
 * 30-minute reminder is the arrival notification; this module is what the
 * person finds when they open the app because of it.
 *
 * The prompt is therefore a STATE, not an event. It is derived on read from
 * facts that already exist (RSVP, check-in window, check-in row) rather than
 * scheduled, which also means it cannot fire late, cannot double-fire, and
 * needs no job, no row and no cron -- relevant while the schedulers are
 * paused.
 */

export type ArrivalPromptInput = {
  /** The viewer's own RSVP. null covers "never RSVP'd" and "is the host". */
  myRsvp: "interested" | "going" | "not_going" | null;
  isHost: boolean;
  /** From resolveCheckInWindow -- the canonical window, not a second one. */
  checkInWindowOpen: boolean;
  /** True when the viewer already holds a live check-in for this event. */
  alreadyCheckedIn: boolean;
  /** Blocked either way, or the event is otherwise unreachable. */
  accessDenied: boolean;
  /** Epoch ms of the viewer's last "Not yet", if they have said it. */
  snoozedUntilMs: number | null;
  nowMs: number;
};

export type ArrivalPromptReason =
  | "visible"
  | "not_going"
  | "not_committed"
  | "window_closed"
  | "already_checked_in"
  | "access_denied"
  | "snoozed";

export type ArrivalPromptResult = { visible: boolean; reason: ArrivalPromptReason };

/**
 * How long "Not yet" holds the prompt back.
 *
 * Long enough that dismissing it means something (§14: no prompting every
 * five minutes), short enough that someone who arrives an hour into a long
 * event can still be offered check-in once more. One repeat, not a loop.
 */
export const ARRIVAL_SNOOZE_MS = 45 * 60 * 1000;

/**
 * Should the "Are you here?" state be shown?
 *
 * Order is deliberate: the cheapest and most absolute denials first, so the
 * reason returned is the most informative one. `access_denied` outranks
 * everything -- a blocked viewer is not told anything about the event.
 */
export function resolveArrivalPrompt(input: ArrivalPromptInput): ArrivalPromptResult {
  if (input.accessDenied) return { visible: false, reason: "access_denied" };
  if (input.alreadyCheckedIn) return { visible: false, reason: "already_checked_in" };

  // Only a commitment earns the prompt. "Interested" is curiosity, and asking
  // someone who never said they were coming whether they have arrived is a
  // question they did not invite. A host is treated as committed to their own
  // event without needing to RSVP to it.
  if (input.myRsvp === "not_going") return { visible: false, reason: "not_going" };
  if (!input.isHost && input.myRsvp !== "going") return { visible: false, reason: "not_committed" };

  // The canonical check-in window decides when arrival is plausible. This
  // module never re-derives it from starts_at.
  if (!input.checkInWindowOpen) return { visible: false, reason: "window_closed" };

  if (input.snoozedUntilMs !== null && input.nowMs < input.snoozedUntilMs) {
    return { visible: false, reason: "snoozed" };
  }

  return { visible: true, reason: "visible" };
}

/** When a "Not yet" tap should stop suppressing the prompt. */
export function arrivalSnoozeUntilMs(nowMs: number): number {
  return nowMs + ARRIVAL_SNOOZE_MS;
}

/**
 * What "Not yet" must NOT do (§14), stated as data so it can be asserted.
 *
 * This is not decoration: the risk with a dismissal control is that it
 * quietly becomes a decline. Not yet means "not right now" and touches
 * nothing else -- not the RSVP, not presence, not attendance.
 */
export const NOT_YET_EFFECTS = {
  changesRsvp: false,
  marksNotGoing: false,
  checksIn: false,
  enablesEventGlow: false,
  permanentlySuppresses: false
} as const;
