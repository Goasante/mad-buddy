/**
 * Pure helpers for live, animated notification signals — the ones worth
 * interrupting the current page for (a Muddy waving, an achievement
 * unlocking) rather than only bumping the unread badge.
 *
 * Notifications store their subject in the `type` column using the existing
 * `"<base>:<id>"` convention (see CreateNotificationInput in
 * lib/notifications/server.ts) — there is no separate payload column — so the
 * subject is parsed back out of the type rather than trusting any
 * client-supplied field.
 */

/** How long a signal stays on screen before it fades out. */
export const LIVE_SIGNAL_DURATION_MS = 6000;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Achievement codes are catalog slugs, e.g. "first_muddy". */
const ACHIEVEMENT_CODE_PATTERN = /^[a-z0-9_]+$/;

export type LiveSignal =
  | { kind: "wave"; senderId: string }
  | { kind: "achievement"; code: string };

/**
 * The live signal a notification type represents, or null when it is an
 * ordinary notification that should only update the badge.
 *
 * Matching is on the exact base before the first ":", so a longer base that
 * merely starts with a known one (e.g. "wavelength:") is never mistaken for a
 * signal.
 */
export function parseLiveSignal(type: string | null | undefined): LiveSignal | null {
  if (!type) return null;
  const separatorIndex = type.indexOf(":");
  if (separatorIndex === -1) return null;

  const base = type.slice(0, separatorIndex);
  const subject = type.slice(separatorIndex + 1);

  if (base === "wave") {
    return UUID_PATTERN.test(subject) ? { kind: "wave", senderId: subject } : null;
  }
  if (base === "achievement") {
    return ACHIEVEMENT_CODE_PATTERN.test(subject) ? { kind: "achievement", code: subject } : null;
  }
  return null;
}

/**
 * Whether a just-received signal is recent enough to animate.
 *
 * A reconnecting realtime channel can replay an older row, and animating
 * "someone is waving right now" for a wave from an hour ago would be a lie.
 * Anything outside the freshness window updates the badge only.
 */
export function isFreshSignal(createdAtIso: string, nowMs: number, freshnessMs = 30_000): boolean {
  const createdAtMs = Date.parse(createdAtIso);
  if (Number.isNaN(createdAtMs)) return false;
  // Allow a small negative skew: the row is stamped by the database clock,
  // which can sit slightly ahead of the browser's.
  return createdAtMs - nowMs <= freshnessMs && nowMs - createdAtMs <= freshnessMs;
}
