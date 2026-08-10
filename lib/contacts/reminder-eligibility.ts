/**
 * When Mad Buddy may remind somebody that Contact Discovery exists.
 *
 * ONE service, and it is pure. Every rule about timing, dismissal and surface
 * lives here rather than in components, so a prompt cannot start appearing
 * somewhere by accident and the whole policy can be read in one place.
 *
 * WHAT THIS NEVER DOES: touch contacts. A reminder is an invitation into the
 * setup flow that already exists, nothing more. It cannot request a permission,
 * cannot open the picker, cannot enable discovery and cannot add a number --
 * §19 has a regression guard for exactly that, because a reminder that
 * triggered an OS dialog would be the worst version of this feature.
 */

/**
 * How long to wait after each "Maybe later".
 *
 * Escalating, because someone who declines twice is telling us something the
 * first decline did not. The intervals are here rather than scattered through
 * components so the cadence can be reasoned about as a whole.
 */
export const REMINDER_COOLDOWN_DAYS = [3, 7, 14] as const;

/**
 * Dismissals after which automatic prompting stops entirely.
 *
 * Three declines is a decision. Continuing past that is nagging, and the
 * feature stays reachable from Muddies and Settings regardless.
 */
export const MAX_REMINDER_DISMISSALS = 3;

/**
 * How long a deliberate privacy change silences reminders.
 *
 * Removing a number or switching discovery off is a choice, not an oversight.
 * Asking someone to undo it days later reads as not listening, so this is
 * longer than any dismissal cooldown.
 */
export const PRIVACY_CHANGE_QUIET_DAYS = 30;

/**
 * How long a new account is left alone.
 *
 * Onboarding already asks a lot. A prompt on day zero competes with learning
 * what the product is, so the first opportunity waits until the account has
 * actually been used.
 */
export const NEW_ACCOUNT_QUIET_HOURS = 24;

const DAY_MS = 24 * 60 * 60 * 1000;

export type ContactReminderKind = "add_phone" | "find_muddies";

export type ContactReminderState = {
  /** ISO timestamp of the last prompt, or null if never prompted. */
  lastPromptedAt: string | null;
  dismissCount: number;
  /** ISO timestamp before which no automatic prompt may show. */
  suppressedUntil: string | null;
  /** "Don't ask again". Suppresses automatic prompts, never the feature. */
  permanentlyDismissed: boolean;
  /** ISO timestamp when setup was deliberately completed, or null. */
  setupCompletedAt: string | null;
};

export const EMPTY_REMINDER_STATE: ContactReminderState = {
  lastPromptedAt: null,
  dismissCount: 0,
  suppressedUntil: null,
  permanentlyDismissed: false,
  setupCompletedAt: null
};

/**
 * Surfaces where an automatic prompt must never appear.
 *
 * ONE list, checked by the single mounted prompt. Interrupting any of these
 * ranges from rude to genuinely harmful -- Safe Arrival is a safety flow, and
 * a card over a camera or a composer is a mis-tap waiting to happen.
 *
 * Prefix-matched, so detail and sub-routes inherit the exclusion.
 */
export const REMINDER_EXCLUDED_PREFIXES: readonly string[] = [
  "/scan", // camera viewfinder
  "/safe-arrival", // an active journey is a safety surface
  "/messages/", // an open conversation, with its composer
  "/plans/", // creating or editing a plan
  "/events/", // creating or editing an event
  "/settings", // often mid-edit, and where the feature's own controls live
  "/onboarding",
  "/login",
  "/signup",
  "/billing", // payment must never be interrupted
  "/upgrade",
  "/profile" // frequently an edit form with unsaved changes
];

/**
 * Transient states that suppress a prompt regardless of route.
 *
 * A route alone cannot tell whether the camera is open over Home, or a voice
 * note is recording, so the shell passes what it knows.
 */
export type ActivityState = {
  cameraOpen?: boolean;
  editingMedia?: boolean;
  recording?: boolean;
  inCall?: boolean;
  composerActive?: boolean;
  /** A form with unsaved changes, or a destructive confirmation. */
  hasUnsavedWork?: boolean;
  /** A dialog, sheet or full-screen viewer is already open. */
  overlayOpen?: boolean;
};

export function isExcludedSurface(pathname: string | null | undefined): boolean {
  if (!pathname) return true;
  const path = pathname.split("?")[0].split("#")[0];
  return REMINDER_EXCLUDED_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix));
}

export function isBusy(activity: ActivityState | undefined): boolean {
  if (!activity) return false;
  // Any one of these means the person is mid-task. Fail closed: an unknown
  // combination should suppress rather than interrupt.
  return Boolean(
    activity.cameraOpen ||
      activity.editingMedia ||
      activity.recording ||
      activity.inCall ||
      activity.composerActive ||
      activity.hasUnsavedWork ||
      activity.overlayOpen
  );
}

export type ReminderInput = {
  /** Whether a phone number is saved. Decides WHICH prompt, not whether. */
  hasPhone: boolean;
  discoveryEnabled: boolean;
  state: ContactReminderState;
  pathname: string | null | undefined;
  activity?: ActivityState;
  /** ISO timestamp the account was created. */
  accountCreatedAt: string | null;
  nowMs?: number;
};

export type ReminderDecision =
  | { show: true; kind: ContactReminderKind }
  | { show: false; reason: ReminderSuppressionReason };

export type ReminderSuppressionReason =
  | "permanently_dismissed"
  | "setup_complete"
  | "cooling_down"
  | "excluded_surface"
  | "busy"
  | "too_new"
  | "dismissed_enough";

/**
 * The single decision.
 *
 * Deterministic: the same inputs always produce the same answer, so the
 * behaviour can be tested without mounting anything or waiting for a clock.
 *
 * Ordered cheapest and most absolute first. A permanently dismissed user is
 * never prompted whatever else is true, and there is no point evaluating
 * cooldowns on a surface that could not show a prompt anyway.
 */
export function shouldContactDiscoveryReminderShow(input: ReminderInput): ReminderDecision {
  const now = input.nowMs ?? Date.now();
  const { state } = input;

  if (state.permanentlyDismissed) return { show: false, reason: "permanently_dismissed" };

  // SETUP COMPLETE is deliberately not "a phone number exists". Someone may
  // have added a number and never gone near their contacts, which is exactly
  // the person the second prompt is for.
  if (state.setupCompletedAt) return { show: false, reason: "setup_complete" };

  if (state.dismissCount >= MAX_REMINDER_DISMISSALS) {
    return { show: false, reason: "dismissed_enough" };
  }

  if (isExcludedSurface(input.pathname)) return { show: false, reason: "excluded_surface" };
  if (isBusy(input.activity)) return { show: false, reason: "busy" };

  // Covers both dismissal cooldowns and the longer quiet period after a
  // deliberate privacy change -- one field, so nothing can set one and forget
  // the other.
  if (state.suppressedUntil && Date.parse(state.suppressedUntil) > now) {
    return { show: false, reason: "cooling_down" };
  }

  if (input.accountCreatedAt) {
    const ageMs = now - Date.parse(input.accountCreatedAt);
    if (Number.isFinite(ageMs) && ageMs < NEW_ACCOUNT_QUIET_HOURS * 60 * 60 * 1000) {
      return { show: false, reason: "too_new" };
    }
  }

  // WHICH prompt. No phone means there is nothing to be discoverable by, so
  // asking someone to connect contacts first would be out of order.
  return { show: true, kind: input.hasPhone ? "find_muddies" : "add_phone" };
}

/**
 * The state after a "Maybe later".
 *
 * Pure, so the cadence is testable without a database. The caller persists
 * whatever this returns.
 */
export function afterDismissal(
  state: ContactReminderState,
  nowMs: number = Date.now()
): ContactReminderState {
  const dismissCount = state.dismissCount + 1;
  // Past the end of the table, the last interval repeats -- though
  // MAX_REMINDER_DISMISSALS stops prompting before that matters.
  const days = REMINDER_COOLDOWN_DAYS[Math.min(dismissCount - 1, REMINDER_COOLDOWN_DAYS.length - 1)];

  return {
    ...state,
    dismissCount,
    lastPromptedAt: new Date(nowMs).toISOString(),
    suppressedUntil: new Date(nowMs + days * DAY_MS).toISOString()
  };
}

/**
 * The state after a deliberate privacy change.
 *
 * Removing a number or switching discovery off is a decision. This goes quiet
 * for a month rather than asking them to reconsider next week -- and does NOT
 * increment the dismissal count, because declining a prompt and changing a
 * setting are different acts.
 */
export function afterPrivacyChange(
  state: ContactReminderState,
  nowMs: number = Date.now()
): ContactReminderState {
  return {
    ...state,
    suppressedUntil: new Date(nowMs + PRIVACY_CHANGE_QUIET_DAYS * DAY_MS).toISOString()
  };
}

/** The state after finishing setup. Ends automatic prompting for good. */
export function afterSetupComplete(
  state: ContactReminderState,
  nowMs: number = Date.now()
): ContactReminderState {
  return { ...state, setupCompletedAt: new Date(nowMs).toISOString() };
}

/**
 * "Don't ask again".
 *
 * Reminder preference ONLY. It does not disable discovery, remove a number or
 * touch a single friendship -- and Find Your Muddies stays reachable from
 * Muddies and Settings.
 */
export function afterPermanentDismissal(state: ContactReminderState): ContactReminderState {
  return { ...state, permanentlyDismissed: true };
}

/**
 * A stable per-account offset, so a release does not prompt everyone at once.
 *
 * Derived from the user id by a plain digit sum: deterministic, needs no
 * stored value and no write, and spreads existing accounts across the window
 * rather than giving every one of them a card on the same afternoon.
 */
export function staggerOffsetHours(userId: string, windowHours = 72): number {
  let total = 0;
  for (let index = 0; index < userId.length; index += 1) total += userId.charCodeAt(index);
  return total % windowHours;
}
