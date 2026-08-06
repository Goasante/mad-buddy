/**
 * Presence freshness.
 *
 * Answers one question: how recently did we hear from this person's device?
 *
 * A Socialize session says someone INTENDED to be discoverable until its
 * expiry. It does not say their device is still reporting. Someone who
 * backgrounded the app twenty minutes ago still has an unexpired session, and
 * showing them as currently nearby would be a claim we cannot support — so
 * presence is derived from the last location update, separately from session
 * expiry.
 *
 * Pure: no React, no queries, no clock of its own beyond the `now` passed in.
 */

/**
 * Thresholds, in ONE place.
 *
 * Justified by the client's own cadence: LocationSignalSync refreshes every
 * 2 minutes, and also on focus and visibility change.
 *
 *  - FRESH (≤3 min) allows one missed update plus latency before anyone is
 *    downgraded, so a healthy device never flickers.
 *  - GRACE (3–7 min) covers a device that has gone quiet — backgrounded, a
 *    tunnel, a dropped connection. Still plausibly present, so still shown,
 *    but described as "recently active" rather than asserted as here.
 *  - EXPIRED (>7 min) is three missed updates. At that point we simply do not
 *    know, and the honest answer is to stop showing them.
 */
export const PRESENCE_FRESH_MS = 3 * 60 * 1000;
export const PRESENCE_GRACE_MS = 7 * 60 * 1000;

export type PresenceState = "fresh" | "grace" | "expired";

/**
 * Classify a last-seen timestamp.
 *
 * Every unusable input resolves to "expired" — a missing, malformed or
 * unparseable timestamp is not evidence of presence, and the safe answer is
 * to stop showing the person rather than to assume they are there.
 *
 * A timestamp in the future is treated as fresh: that means clock skew
 * between the device and the server, not a stale record, and penalising the
 * user for their clock would hide someone who is genuinely present. Skew is
 * bounded — anything beyond a minute ahead is treated as unusable rather than
 * trusted indefinitely.
 */
const MAX_FUTURE_SKEW_MS = 60 * 1000;

export function presenceStateFor(lastUpdated: string | null | undefined, now = Date.now()): PresenceState {
  if (!lastUpdated) return "expired";

  const timestamp = Date.parse(lastUpdated);
  if (Number.isNaN(timestamp)) return "expired";

  const age = now - timestamp;

  if (age < 0) {
    // Ahead of us: modest skew is fine, wild values are not trusted.
    return -age <= MAX_FUTURE_SKEW_MS ? "fresh" : "expired";
  }

  if (age <= PRESENCE_FRESH_MS) return "fresh";
  if (age <= PRESENCE_GRACE_MS) return "grace";
  return "expired";
}

/** Whether this person may still be shown at all. */
export function isPresenceVisible(state: PresenceState): boolean {
  return state !== "expired";
}

/**
 * How to describe someone's presence.
 *
 * Null for "fresh": a person we heard from moments ago needs no qualifier,
 * and their proximity label already says what matters. Grace gets an explicit
 * hedge so the UI never asserts more certainty than it has.
 */
export function presenceLabel(state: PresenceState): string | null {
  return state === "grace" ? "Recently active" : null;
}
