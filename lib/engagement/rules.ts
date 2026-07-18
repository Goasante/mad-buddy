/**
 * Healthy engagement core (feature architecture batch 11). Recaps, streaks,
 * achievements, notification budgets, and Exam Mode.
 *
 * This module is unusual: much of its job is to make the spec's PROHIBITIONS
 * (§44) executable rather than aspirational. Where a rule says "never", there
 * is a function that returns false and a test that pins it. Specifically:
 *  - A streak needs BOTH people to act in the same week. One-sided spam can
 *    never sustain one (§14, §17).
 *  - Nothing here is public. There is no ranking/leaderboard shape at all (§16).
 *  - Streaks cannot be bought back (§18) and losing one is not punished (§19).
 *  - Recaps carry aggregated counts only, never message content or location (§4).
 */

// ---------------------------------------------------------------------------
// Weekly periods (spec §15), weekly, deliberately, not daily.
// ---------------------------------------------------------------------------

/** ISO-week key, e.g. "2026-W29". Weekly cadence is the anti-addiction choice. */
export function weekKey(nowMs: number): string {
  const date = new Date(nowMs);
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  // ISO: Thursday determines the year.
  const dayNumber = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNumber + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const firstDayNumber = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNumber + 3);
  const week = 1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * 24 * 60 * 60 * 1000));
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function previousWeekKey(nowMs: number): string {
  return weekKey(nowMs - 7 * 24 * 60 * 60 * 1000);
}

// ---------------------------------------------------------------------------
// Streak qualification (spec §14, §17)
// ---------------------------------------------------------------------------

export type StreakEventType =
  | "plan_completed"
  | "wave_exchanged"
  | "ping_accepted"
  | "shared_plan"
  | "safe_arrival_completed"
  | "event_checked_in_together"
  | "conversation_activity";

const MEANINGFUL_EVENTS: ReadonlySet<string> = new Set<StreakEventType>([
  "plan_completed",
  "wave_exchanged",
  "ping_accepted",
  "shared_plan",
  "safe_arrival_completed",
  "event_checked_in_together",
  "conversation_activity"
]);

/**
 * Whether an event counts toward a streak. App opens, profile views, location
 * updates, and notification taps are deliberately absent, a streak measures
 * friendship, not usage (spec §14).
 */
export function isMeaningfulMutualInteraction(eventType: string): boolean {
  return MEANINGFUL_EVENTS.has(eventType);
}

export type PeriodEvent = { actorId: string; eventType: StreakEventType };

/**
 * A period qualifies only when BOTH users acted in it. This is the rule that
 * makes a streak un-gameable: repeatedly waving at someone who never responds
 * builds nothing (spec §17).
 */
export function periodQualifies(input: {
  events: PeriodEvent[];
  userOneId: string;
  userTwoId: string;
}): boolean {
  const meaningful = input.events.filter((event) => isMeaningfulMutualInteraction(event.eventType));
  const actors = new Set(meaningful.map((event) => event.actorId));
  return actors.has(input.userOneId) && actors.has(input.userTwoId);
}

export type StreakState = {
  currentWeeks: number;
  longestWeeks: number;
  lastQualifiedPeriod: string | null;
  status: "active" | "paused" | "ended";
  pausedUntilMs: number | null;
};

export type StreakUpdate = {
  currentWeeks: number;
  longestWeeks: number;
  lastQualifiedPeriod: string;
  status: "active" | "paused" | "ended";
  milestoneReached: boolean;
};

/**
 * Advances a streak for a qualifying period. Idempotent: re-reporting the same
 * period is a no-op, so a replayed event can't inflate a streak.
 *
 * A gap of exactly one week is forgiven (spec §15's grace period); a longer gap
 * restarts at 1 rather than punishing.
 */
export function advanceStreak(input: {
  state: StreakState;
  qualifiedPeriod: string;
  previousPeriod: string;
}): StreakUpdate {
  const { state } = input;

  if (state.lastQualifiedPeriod === input.qualifiedPeriod) {
    return {
      currentWeeks: state.currentWeeks,
      longestWeeks: state.longestWeeks,
      lastQualifiedPeriod: state.lastQualifiedPeriod,
      status: state.status,
      milestoneReached: false
    };
  }

  // Continue when the last qualification was the immediately previous week;
  // otherwise start fresh at 1.
  const continues = state.lastQualifiedPeriod === input.previousPeriod;
  const currentWeeks = continues ? state.currentWeeks + 1 : 1;

  return {
    currentWeeks,
    longestWeeks: Math.max(state.longestWeeks, currentWeeks),
    lastQualifiedPeriod: input.qualifiedPeriod,
    status: "active",
    milestoneReached: STREAK_MILESTONES.includes(currentWeeks)
  };
}

export const STREAK_MILESTONES = [4, 12, 26, 52];

export function isStreakPaused(state: StreakState, nowMs: number): boolean {
  return state.status === "paused" && state.pausedUntilMs !== null && state.pausedUntilMs > nowMs;
}

export const STREAK_PAUSE_OPTIONS_WEEKS = [1, 2, 4, 8] as const;

/**
 * Pausing is always free. There is no paid path to preserve or restore a
 * streak, spec §18 forbids monetising it, so no function here accepts a plan.
 */
export function pauseUntilMs(weeks: number, nowMs: number): number {
  const clamped = Math.min(Math.max(weeks, 1), 8);
  return nowMs + clamped * 7 * 24 * 60 * 60 * 1000;
}

/** Non-punitive copy (spec §19). Never "you lost your streak". */
export const STREAK_ENDED_MESSAGE =
  "Your weekly connection streak has ended. You can start a new one anytime.";

export function streakSummaryLabel(weeks: number, friendName: string): string {
  return `You and ${friendName} have connected for ${weeks} ${weeks === 1 ? "week" : "weeks"}.`;
}

// ---------------------------------------------------------------------------
// Recap (spec §4, §5, §6)
// ---------------------------------------------------------------------------

/**
 * The complete set of fields a recap may contain. Anything not listed here is
 * excluded by construction, which is how §4's "do not include" list is
 * enforced rather than remembered.
 */
export type RecapSummary = {
  plansCreated: number;
  plansCompleted: number;
  muddiesInteractedWith: number;
  newMuddies: number;
  circlesActive: number;
  wavesSent: number;
  wavesReturned: number;
  hangoutSessions: number;
  mostCommonActivity: string | null;
  daysVisible: number;
  ghostModeUsed: number;
};

export const RECAP_ALLOWED_FIELDS: ReadonlyArray<keyof RecapSummary> = [
  "plansCreated",
  "plansCompleted",
  "muddiesInteractedWith",
  "newMuddies",
  "circlesActive",
  "wavesSent",
  "wavesReturned",
  "hangoutSessions",
  "mostCommonActivity",
  "daysVisible",
  "ghostModeUsed"
];

/**
 * Strips anything not explicitly allowed. Defence in depth for §4: even if an
 * aggregation query accidentally selects message text or a place name, it
 * cannot reach the stored summary.
 */
export function sanitizeRecapSummary(raw: Record<string, unknown>): RecapSummary {
  const output = {} as RecapSummary;
  for (const field of RECAP_ALLOWED_FIELDS) {
    const value = raw[field];
    if (field === "mostCommonActivity") {
      output.mostCommonActivity = typeof value === "string" ? value : null;
    } else {
      (output as Record<string, unknown>)[field] = typeof value === "number" && Number.isFinite(value) ? value : 0;
    }
  }
  return output;
}

/**
 * Warm, neutral framing (spec §6). Never comparative ("you only met 2"), never
 * shaming, the copy states what happened and stops.
 */
export function recapHeadline(summary: RecapSummary): string {
  if (summary.muddiesInteractedWith === 0 && summary.plansCompleted === 0) {
    // Empty period must not read as failure (spec §12 edge case).
    return "A quiet month. Your Muddies are here whenever you are.";
  }
  if (summary.muddiesInteractedWith > 0) {
    return `You made time for ${summary.muddiesInteractedWith} ${
      summary.muddiesInteractedWith === 1 ? "Muddy" : "different Muddies"
    } this month.`;
  }
  return `You completed ${summary.plansCompleted} ${summary.plansCompleted === 1 ? "plan" : "plans"} this month.`;
}

export const RECAP_REFLECTION_PROMPT = "Which friendship do you want to make more time for next month?";

// ---------------------------------------------------------------------------
// Notification budget + red dots (spec §45, §46)
// ---------------------------------------------------------------------------

export const DEFAULT_DAILY_NOTIFICATION_BUDGET = 8;

/** Users may go stricter, never looser (spec §45). */
export function clampNotificationBudget(requested: number): number {
  if (!Number.isFinite(requested)) return DEFAULT_DAILY_NOTIFICATION_BUDGET;
  return Math.min(Math.max(Math.floor(requested), 0), DEFAULT_DAILY_NOTIFICATION_BUDGET);
}

export type BudgetDecision = {
  allowed: boolean;
  reason: "critical_bypass" | "high_priority_bypass" | "within_budget" | "budget_exhausted";
};

/**
 * Whether a push fits the day's budget. Critical and high-priority items
 * (security, a Ping, a plan change) bypass it, the budget exists to stop
 * low-value noise, not to swallow things the user actually needs (spec §45).
 */
export function checkNotificationBudget(input: {
  priority: "critical" | "high" | "normal" | "low";
  sentToday: number;
  budget: number;
}): BudgetDecision {
  if (input.priority === "critical") return { allowed: true, reason: "critical_bypass" };
  if (input.priority === "high") return { allowed: true, reason: "high_priority_bypass" };
  if (input.sentToday >= input.budget) return { allowed: false, reason: "budget_exhausted" };
  return { allowed: true, reason: "within_budget" };
}

export type RedDotSurface =
  | "direct_message"
  | "meeting_ping"
  | "plan_response"
  | "security_alert"
  | "event_update"
  | "product_tip"
  | "achievement"
  | "recap"
  | "marketing"
  | "circle_activity";

const RED_DOT_ALLOWED: ReadonlySet<RedDotSurface> = new Set<RedDotSurface>([
  "direct_message",
  "meeting_ping",
  "plan_response",
  "security_alert",
  "event_update"
]);

/**
 * Unread indicators are reserved for things a person actually needs to act on.
 * Achievements, recaps, tips, and marketing never get a dot (spec §46),
 * that's the difference between an indicator and a manipulation.
 */
export function allowsRedDot(surface: RedDotSurface): boolean {
  return RED_DOT_ALLOWED.has(surface);
}

// ---------------------------------------------------------------------------
// Exam Mode (spec §38)
// ---------------------------------------------------------------------------

export type ExamModeDuration = "2h" | "until_tonight" | "1w" | "custom";

export function examModeEndsAtMs(duration: Exclude<ExamModeDuration, "custom">, nowMs: number): number {
  switch (duration) {
    case "2h":
      return nowMs + 2 * 60 * 60 * 1000;
    case "until_tonight": {
      const end = new Date(nowMs);
      end.setHours(23, 59, 0, 0);
      const ms = end.getTime();
      return ms > nowMs ? ms : nowMs + 2 * 60 * 60 * 1000;
    }
    case "1w":
      return nowMs + 7 * 24 * 60 * 60 * 1000;
  }
}

export function isExamModeActive(examModeUntilMs: number | null, nowMs: number): boolean {
  return examModeUntilMs !== null && examModeUntilMs > nowMs;
}

export type ExamModeDecision = { deliver: boolean; reason: string };

/**
 * Exam Mode quiets social noise without cutting someone off: Close Friends can
 * still reach you if you allow it, and critical alerts always land (spec §38).
 */
export function examModeAllows(input: {
  priority: "critical" | "high" | "normal" | "low";
  fromCloseFriend: boolean;
  allowCloseFriends: boolean;
}): ExamModeDecision {
  if (input.priority === "critical") return { deliver: true, reason: "critical" };
  if (input.fromCloseFriend && input.allowCloseFriends) return { deliver: true, reason: "close_friend" };
  if (input.priority === "high") return { deliver: true, reason: "high_priority" };
  return { deliver: false, reason: "exam_mode" };
}

// ---------------------------------------------------------------------------
// Finite Pulse + non-coercive copy (spec §35, §39, §40, §44)
// ---------------------------------------------------------------------------

export const ALL_CAUGHT_UP_MESSAGE = "You're all caught up.";
export const NOTHING_URGENT_MESSAGE = "Nothing urgent is waiting. You can come back later.";

/**
 * The Pulse is finite by contract: it returns a bounded list and then says so.
 * There is no "load more" continuation here, which is how §44's infinite-scroll
 * prohibition is kept true as the feed evolves.
 */
export const PULSE_MAX_ITEMS = 50;
export const PULSE_IS_FINITE = true;

/**
 * Patterns the product must never ship (spec §44). Kept as data so the
 * dark-pattern checklist (§49) is reviewable in code and in tests, rather than
 * living only in a document nobody opens.
 */
export const PROHIBITED_PATTERNS = [
  "infinite_scroll",
  "random_variable_rewards",
  "daily_login_rewards",
  "paid_streak_recovery",
  "low_value_red_dots",
  "fake_urgency",
  "countdown_pressure",
  "public_popularity_metrics",
  "friend_rankings",
  "read_receipt_pressure",
  "someone_viewed_you_bait",
  "fear_based_location_alerts",
  "excessive_push_reminders",
  "autoplay_video",
  "unavoidable_promo_popups"
] as const;

export type ProhibitedPattern = (typeof PROHIBITED_PATTERNS)[number];

// ---------------------------------------------------------------------------
// Composition with the batch-4 notification engine (spec §51)
// ---------------------------------------------------------------------------

export type BaseNotificationDecision = { inApp: boolean; push: boolean; reason: string };

/**
 * Layers Exam Mode and the daily budget on top of the batch-4
 * decideNotification result. Composed rather than merged into that function so
 * each engine stays independently testable, and so the ordering is explicit:
 *
 *   category preferences → quiet hours   (batch 4)
 *   → Exam Mode → daily budget           (here)
 *
 * Guards only ever REMOVE a push, never add one: if batch 4 already decided
 * not to push, nothing here can override that.
 */
export function applyEngagementGuards(
  base: BaseNotificationDecision,
  context: {
    priority: "critical" | "high" | "normal" | "low";
    examModeUntilMs: number | null;
    examModeAllowCloseFriends: boolean;
    fromCloseFriend: boolean;
    sentToday: number;
    budget: number;
    nowMs: number;
  }
): BaseNotificationDecision {
  // In-app delivery is never suppressed by these guards, the item still
  // exists, it just doesn't interrupt.
  if (!base.push) return base;

  if (isExamModeActive(context.examModeUntilMs, context.nowMs)) {
    const decision = examModeAllows({
      priority: context.priority,
      fromCloseFriend: context.fromCloseFriend,
      allowCloseFriends: context.examModeAllowCloseFriends
    });
    if (!decision.deliver) return { inApp: base.inApp, push: false, reason: "exam_mode" };
  }

  const budget = checkNotificationBudget({
    priority: context.priority,
    sentToday: context.sentToday,
    budget: context.budget
  });
  if (!budget.allowed) return { inApp: base.inApp, push: false, reason: "budget_exhausted" };

  return base;
}
