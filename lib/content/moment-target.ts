import type { MomentTab } from "@/lib/content/moments-tabs";
import type { VisibleMoment } from "@/lib/content/service";

/**
 * Exact-Moment targeting for /moments?tab=<tab>&moment=<id>.
 *
 * Pure resolution against an ALREADY-AUTHORISED feed. This module never
 * queries and never signs media: it is handed the same VisibleMoment lists the
 * page already renders, so a target can only resolve to something the viewer
 * was already allowed to see. An id the viewer cannot see simply does not
 * match, which is why "unauthorised", "deleted" and "never existed" all take
 * the identical path below and produce the identical message.
 */

/** The query parameter carrying the exact Moment id. */
export const MOMENT_PARAM = "moment";

/**
 * Shown when a target cannot be resolved.
 *
 * Deliberately one message for every failure: expired, deleted, blocked,
 * unauthorised, wrong tab, or simply never existed. Distinguishing them would
 * let a caller probe whether a given id exists, so the copy stays uniform and
 * says nothing about why.
 */
export const UNAVAILABLE_MESSAGE = "This Moment is no longer available.";

/** A Moment id is a UUID. Anything else is rejected before it is used. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Normalise a raw `?moment=` value.
 *
 * Returns null for anything that is not a well-formed id, so a malformed or
 * hostile value is discarded before it reaches a lookup or the DOM.
 */
export function parseMomentParam(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim();
  return UUID.test(value) ? value.toLowerCase() : null;
}

/** The DOM id for a Moment's card, used to scroll and focus the exact target. */
export function momentAnchorId(momentId: string): string {
  return `moment-${momentId}`;
}

/**
 * Build a link that opens one exact Moment.
 *
 * Air items route to the Air tab, everything else to Moments, so the tab the
 * viewer lands on always actually contains the target.
 */
export function momentHref(momentId: string, tab: Extract<MomentTab, "moments" | "air">): string {
  return `/moments?tab=${tab}&${MOMENT_PARAM}=${momentId}`;
}

export type MomentTargetResolution =
  | { status: "none" }
  | { status: "found"; moment: VisibleMoment; index: number }
  | { status: "unavailable"; message: string };

/**
 * Resolve `?moment=` against the feed the selected tab is rendering.
 *
 * `index` is the target's position in the feed AS GIVEN — the caller scrolls to
 * it. The feed is never reordered to bring a target to the front, so the
 * sequence around it stays exactly what every other viewer sees.
 */
export function resolveMomentTarget(
  rawParam: string | null | undefined,
  feed: readonly VisibleMoment[],
  { nowMs = Date.now() } = {}
): MomentTargetResolution {
  const targetId = parseMomentParam(rawParam);
  if (!targetId) {
    // No target requested (or an unusable one): the normal page, no message.
    return { status: "none" };
  }

  const index = feed.findIndex((moment) => moment.id === targetId);
  // Not in this feed: unauthorised, deleted, or on the other tab. All the same
  // answer — the page renders normally with a neutral notice.
  if (index === -1) return { status: "unavailable", message: UNAVAILABLE_MESSAGE };

  const moment = feed[index]!;
  // Expiry is enforced by the server too; this stops a stale client list from
  // scrolling to something that has since lapsed.
  if (Date.parse(moment.expiresAt) <= nowMs) {
    return { status: "unavailable", message: UNAVAILABLE_MESSAGE };
  }

  return { status: "found", moment, index };
}

/**
 * Drop `?moment=` while keeping the tab.
 *
 * Used once a target has been consumed or found invalid, so reloading or
 * sharing the URL does not re-trigger the jump or re-announce the notice.
 */
export function urlWithoutMomentParam(tab: MomentTab): string {
  return `/moments?tab=${tab}`;
}

/**
 * Rotate an authorised sequence so the selected Moment leads.
 *
 * A, B, C, D with C selected becomes C, D, A, B — the existing order is kept
 * intact and simply started from a different point, so "next" still means the
 * same neighbour it always did and nothing is re-sorted.
 *
 * This is a VIEW of the sequence, not a replacement for it: the caller keeps
 * the canonical feed exactly as the server returned it and uses this only for
 * the surface that steps through Moments one at a time. The page's own list is
 * never rotated — doing so would reorder the feed the viewer is scrolling.
 *
 * Returns the input order unchanged when the target is absent, so an invalid
 * or unauthorised id degrades to the normal sequence rather than an empty one.
 */
export function rotateSequenceToTarget(
  sequence: readonly VisibleMoment[],
  targetId: string | null | undefined
): VisibleMoment[] {
  const id = parseMomentParam(targetId);
  if (!id) return [...sequence];

  const index = sequence.findIndex((moment) => moment.id === id);
  // Not in this sequence: unauthorised, expired or simply elsewhere. The
  // caller shows the normal order rather than nothing.
  if (index <= 0) return [...sequence];

  // Slice, never splice: the input is left untouched, and because the two
  // slices partition the array exactly, no Moment can be dropped or repeated.
  return [...sequence.slice(index), ...sequence.slice(0, index)];
}
