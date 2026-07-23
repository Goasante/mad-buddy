/**
 * Pure helpers for the live Wave signal.
 *
 * A wave notification stores its sender in the `type` column using the
 * existing `"<base>:<id>"` convention (see CreateNotificationInput in
 * lib/notifications/server.ts) — there is no separate payload column — so the
 * sender id is parsed back out of the type rather than trusting any
 * client-supplied field.
 */

/** How long the wave animation stays on screen before it fades out. */
export const WAVE_TOAST_DURATION_MS = 6000;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The sender's user id when `type` is a wave notification, else null.
 *
 * Returns null for any other notification base (so a "wavelength" style type
 * can never be mistaken for a wave) and for a malformed id.
 */
export function waveSenderIdFromType(type: string | null | undefined): string | null {
  if (!type) return null;
  const separatorIndex = type.indexOf(":");
  if (separatorIndex === -1) return null;
  if (type.slice(0, separatorIndex) !== "wave") return null;
  const senderId = type.slice(separatorIndex + 1);
  return UUID_PATTERN.test(senderId) ? senderId : null;
}

/**
 * Whether a just-received wave is recent enough to animate.
 *
 * A reconnecting realtime channel can replay an older row, and showing a
 * "someone is waving right now" animation for a wave from an hour ago would
 * be a lie. Anything older than the freshness window updates the badge only.
 */
export function isFreshWave(createdAtIso: string, nowMs: number, freshnessMs = 30_000): boolean {
  const createdAtMs = Date.parse(createdAtIso);
  if (Number.isNaN(createdAtMs)) return false;
  // Allow a small negative skew: the row is stamped by the database clock,
  // which can sit slightly ahead of the browser's.
  return createdAtMs - nowMs <= freshnessMs && nowMs - createdAtMs <= freshnessMs;
}
