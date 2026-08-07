/**
 * Deterministic reconnect eligibility.
 *
 * Pure: given facts about a relationship and a clock, decides whether to
 * offer a warm nudge. No AI, no model, no scoring — this ships and is useful
 * before any provider is chosen.
 *
 * THE RULE THIS MODULE EXISTS TO ENFORCE: never judge a friendship.
 *
 * It computes staleness, which is a fact about interaction dates. It does not
 * compute quality, health, strength or worth, and it returns no number a
 * caller could render as a score. The output is a suggestion or silence.
 *
 * User-facing copy lives here too, so "we noticed you haven't spoken" can
 * never be written into a component by accident.
 */

export type ReconnectFacts = {
  /** Null while the friendship is active. */
  endedAtMs: number | null;
  /** Most recent factual interaction: a plan attended, a reconnect completed. */
  lastInteractionAtMs: number | null;
  /** How many factual interactions have ever been recorded. */
  interactionCount: number;
  /** The viewer blocked them, or they blocked the viewer. Either direction. */
  blocked: boolean;
  /** When the viewer last dismissed a suggestion about this person. */
  dismissedAtMs: number | null;
  /** When the viewer snoozed a suggestion about this person. */
  snoozedUntilMs: number | null;
  /** When a reconnect with this person was last completed. */
  lastReconnectAtMs: number | null;
};

export type ReconnectReason =
  | "eligible"
  | "blocked"
  | "snoozed"
  | "recently_dismissed"
  | "recently_reconnected"
  | "recent_interaction"
  | "never_interacted"
  | "no_history";

export type ReconnectDecision = {
  eligible: boolean;
  reason: ReconnectReason;
  /** When this could next become eligible. Null when it never will. */
  nextEligibleAtMs: number | null;
};

const DAY = 24 * 60 * 60 * 1000;

/**
 * How quiet a relationship must be before a nudge is offered.
 *
 * Long on purpose. Six weeks is a gap someone might genuinely be glad to be
 * reminded of; two weeks is just a normal fortnight and nagging about it
 * would make the product feel needy.
 */
export const RECONNECT_QUIET_PERIOD_MS = 42 * DAY;

/** A dismissal is respected for this long before the suggestion may return. */
export const RECONNECT_DISMISSAL_MS = 60 * DAY;

/** After a completed reconnect, the pair is left alone for this long. */
export const RECONNECT_COOLDOWN_MS = 90 * DAY;

/**
 * Minimum shared history before suggesting a reconnect.
 *
 * One interaction is not a relationship. Suggesting you reconnect with
 * someone you met once would read as the product padding its output.
 */
export const RECONNECT_MIN_INTERACTIONS = 2;

/**
 * Decide whether to offer a reconnect suggestion.
 *
 * Suppression is checked before eligibility throughout: a blocked, snoozed or
 * recently-dismissed relationship is never evaluated further, so no reason
 * code can leak that a suggestion "would have" fired.
 */
export function evaluateReconnect(facts: ReconnectFacts, nowMs: number): ReconnectDecision {
  // Safety first: a blocked pair is never eligible and never becomes so.
  if (facts.blocked) {
    return { eligible: false, reason: "blocked", nextEligibleAtMs: null };
  }

  if (facts.snoozedUntilMs !== null && nowMs < facts.snoozedUntilMs) {
    return { eligible: false, reason: "snoozed", nextEligibleAtMs: facts.snoozedUntilMs };
  }

  if (facts.dismissedAtMs !== null) {
    const until = facts.dismissedAtMs + RECONNECT_DISMISSAL_MS;
    if (nowMs < until) {
      return { eligible: false, reason: "recently_dismissed", nextEligibleAtMs: until };
    }
  }

  if (facts.lastReconnectAtMs !== null) {
    const until = facts.lastReconnectAtMs + RECONNECT_COOLDOWN_MS;
    if (nowMs < until) {
      return { eligible: false, reason: "recently_reconnected", nextEligibleAtMs: until };
    }
  }

  // Not enough shared history to have anything to reconnect about.
  if (facts.interactionCount < RECONNECT_MIN_INTERACTIONS) {
    return { eligible: false, reason: "never_interacted", nextEligibleAtMs: null };
  }

  if (facts.lastInteractionAtMs === null) {
    return { eligible: false, reason: "no_history", nextEligibleAtMs: null };
  }

  const quietUntil = facts.lastInteractionAtMs + RECONNECT_QUIET_PERIOD_MS;
  if (nowMs < quietUntil) {
    return { eligible: false, reason: "recent_interaction", nextEligibleAtMs: quietUntil };
  }

  return { eligible: true, reason: "eligible", nextEligibleAtMs: null };
}

/**
 * The suggestion's copy.
 *
 * Warm, optional, and about the FUTURE. It never mentions how long it has
 * been, never implies neglect, and never characterises the friendship —
 * because the user did nothing wrong by being busy.
 */
export function reconnectSuggestionCopy(displayName: string): { title: string; body: string } {
  const name = displayName.trim() || "your Muddy";
  return {
    title: `Catch up with ${name}?`,
    body: "No rush — just a thought if you fancy it."
  };
}

/**
 * Words this feature must never say.
 *
 * Exported so tests can assert against the real list rather than a copy that
 * could drift from it.
 */
export const RECONNECT_FORBIDDEN_WORDS = [
  "weak",
  "bad friend",
  "failing",
  "neglect",
  "forgot",
  "losing touch",
  "drifting",
  "score",
  "unhealthy",
  "should have"
];
