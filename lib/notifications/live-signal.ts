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

/** How long the celebration stays on screen before it fades out. */
export const LIVE_SIGNAL_DURATION_MS = 4200;

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
 * Picks the notifications worth animating out of a polled list.
 *
 * Identity, not time, decides what is "new": `seenIds` starts as every row
 * that already existed when the page loaded, so the first poll shows nothing
 * and later polls only surface rows that appeared since. This is deliberately
 * clock-independent — comparing a database timestamp against the browser
 * clock means any device whose clock is off silently animates nothing at all,
 * which is exactly the failure this replaced.
 *
 * Mutates `seenIds` so a signal is only ever shown once, no matter whether the
 * realtime channel or the poll fallback observed it first.
 */
export function selectNewSignals(
  rows: Array<{ id: string; type: string }>,
  seenIds: Set<string>
): Array<{ id: string; signal: LiveSignal }> {
  const fresh: Array<{ id: string; signal: LiveSignal }> = [];
  // Oldest first, so if several arrive at once the newest ends up on screen.
  for (const row of [...rows].reverse()) {
    if (!row?.id || seenIds.has(row.id)) continue;
    seenIds.add(row.id);
    const signal = parseLiveSignal(row.type);
    if (signal) fresh.push({ id: row.id, signal });
  }
  return fresh;
}
