/**
 * Which coordination quick actions a conversation may offer, and when.
 *
 * PURE. No clock of its own, no database -- "may I say I'm here" has to be
 * assertable as arithmetic, because the alternative is what shipped: a
 * hardcoded `QUICK_ACTIONS.slice(0, 3)` rendered in every conversation, which
 * offered "I'm here" in a direct message with no plan at all, and in a Plan
 * Chat days before the plan began.
 *
 * TWO SEPARATE QUESTIONS, previously neither asked:
 *
 *   1. Is this conversation ABOUT a meeting? A direct chat with a friend is
 *      not a coordination surface; arrival language there is noise.
 *   2. Has the meeting come close enough for arrival to be meaningful?
 *      "I'm here" three days early is not early, it is wrong.
 */

/** How the conversation relates to a dated thing, from `context_type`. */
export type ConversationContext = "plan" | "event" | "event_circle" | "safe_arrival" | "none";

/**
 * Where a dated conversation sits relative to its own timing.
 *
 * Deliberately mirrors the vocabulary Events already uses (`eventPhase`)
 * rather than inventing a third set of names for the same idea.
 */
export type MeetingPhase =
  /** Dated, but far enough out that arrival is meaningless. */
  | "upcoming"
  /** Close enough that heading there is a real thing to say. */
  | "near_start"
  /** Happening now. */
  | "active"
  /** Finished, or cancelled. */
  | "ended"
  /** No date to reason about. */
  | "undated";

/**
 * How early arrival talk becomes reasonable.
 *
 * An hour is long enough to cover travel for a local meet-up and short enough
 * that "on my way" still means today, not this week.
 */
export const NEAR_START_WINDOW_MS = 60 * 60 * 1000;

/**
 * How long a meeting with no stated end time stays active.
 *
 * Only a fallback: an explicit end time always wins. Three hours covers an
 * ordinary evening out without keeping "I'm here" available the next morning.
 */
export const DEFAULT_ACTIVE_WINDOW_MS = 3 * 60 * 60 * 1000;

/**
 * Phase from absolute milliseconds.
 *
 * TIME IS COMPARED IN ABSOLUTE MILLISECONDS, matching planPhase() and
 * eventPhase(): every timestamp is a UTC instant, so a browser in Accra and a
 * job in UTC reach the same answer. A conversation's display timezone must
 * never decide this.
 */
export function meetingPhase(
  timing: { startsAtMs: number | null; endsAtMs?: number | null; cancelled?: boolean },
  nowMs: number
): MeetingPhase {
  if (timing.cancelled) return "ended";
  if (timing.startsAtMs === null) return "undated";

  /* END TIME WINS WHERE THERE IS ONE: a meeting running 19:00-23:00 is still
   * on at 20:00, and treating it as over at its start time is what makes a
   * live plan stop offering the one action it actually needs.
   *
   * Most plans carry no end time, so falling back to the start time would mark
   * every one of them "ended" the instant it began -- arrival actions would
   * appear for a single tick and vanish. An undated-end meeting therefore
   * stays active for a default span, matching how a plan without an explicit
   * finish is understood by the people at it. */
  const endMs = timing.endsAtMs ?? timing.startsAtMs + DEFAULT_ACTIVE_WINDOW_MS;
  if (nowMs > endMs) return "ended";
  if (nowMs >= timing.startsAtMs) return "active";
  if (timing.startsAtMs - nowMs <= NEAR_START_WINDOW_MS) return "near_start";
  return "upcoming";
}

/** Every coordination action, with the earliest phase that justifies it. */
const ACTION_ELIGIBILITY: Record<string, readonly MeetingPhase[]> = {
  // Travel intent: meaningful once the meeting is close, not days before.
  on_my_way: ["near_start", "active"],
  running_late: ["near_start", "active"],
  // Presence: only once the meeting is genuinely happening.
  im_here: ["active"],
  // Logistics: useful while a meeting is still being arranged, and still
  // useful once people are converging.
  where_to_meet: ["upcoming", "near_start", "active", "undated"],
  cant_make_it: ["upcoming", "near_start", "active", "undated"],
  start_without_me: ["near_start", "active"]
};

/** Contexts that are ABOUT a meeting, so coordination language belongs. */
const COORDINATION_CONTEXTS: readonly ConversationContext[] = [
  "plan",
  "event",
  "event_circle",
  "safe_arrival"
];

export function isCoordinationContext(context: ConversationContext): boolean {
  return COORDINATION_CONTEXTS.includes(context);
}

/**
 * The quick actions this conversation should offer right now.
 *
 * Returns ids in the caller's original order, so presentation stays the
 * caller's business. An empty array is a legitimate, common answer: a plain
 * direct message offers none of these, which is the correct amount of
 * coordination UI for a chat that is not about a meeting.
 */
export function eligibleQuickActions(input: {
  context: ConversationContext;
  phase: MeetingPhase;
  actionIds: readonly string[];
}): string[] {
  if (!isCoordinationContext(input.context)) return [];
  /* A dated context whose meeting is over coordinates nothing.
   *
   * Belt and braces: no entry in ACTION_ELIGIBILITY lists "ended", so the
   * filter below would already return an empty array. This states the rule
   * once, explicitly, so adding "ended" to some future action's phase list is
   * a deliberate decision made here rather than an accident that quietly
   * revives arrival prompts for finished plans. */
  if (input.phase === "ended") return [];

  return input.actionIds.filter((id) => {
    const phases = ACTION_ELIGIBILITY[id];
    // An unknown action is withheld rather than shown: a new id added to the
    // list without a rule here should not silently inherit "always visible".
    if (!phases) return false;
    return phases.includes(input.phase);
  });
}
