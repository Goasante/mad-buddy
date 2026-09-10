/**
 * Dismiss state for the UpFor "Live & temporary" explainer.
 *
 * The banner used to render unconditionally on every visit, including for
 * returning users who have long since understood that an UpFor expires. That
 * is a permanent block eating a band of the screen forever, not a teaching
 * moment. This follows the same lightweight, per-account localStorage flag
 * pattern already used by the notification-onboarding prompt
 * (lib/notifications/onboarding.ts) rather than the heavier server-authored
 * tour system in lib/tours — there is no step sequence or admin content here,
 * just a single "got it" a person can dismiss once.
 */

const UPFOR_EDUCATION_DISMISSED_PREFIX = "madbuddy-upfor-education-dismissed";

function accountScope(userId: string) {
  // Keeps the raw account id out of the storage key. Not used for security,
  // only to isolate this dismissal between accounts sharing one device.
  let hash = 2_166_136_261;
  for (let index = 0; index < userId.length; index += 1) {
    hash ^= userId.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
}

export function upforEducationStorageKey(userId: string | null | undefined) {
  const scope = userId ? accountScope(userId) : "anon";
  return `${UPFOR_EDUCATION_DISMISSED_PREFIX}:${scope}`;
}
