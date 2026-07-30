import type { SafeArrivalStatus } from "@/lib/supabase/database.types";
import { gracePeriodEndMs } from "@/lib/safety/safe-arrival";

/**
 * Presentation state for the Safe Arrival live-journey animation.
 *
 * Derived ONLY from canonical session data (status + timing). It carries no
 * geography of any kind — no coordinates, distance, route, or map. It answers
 * exactly one question: what is the journey's status right now, and should the
 * calm "alive" animation be running?
 *
 * Copy is deliberately neutral (spec §9): never "monitoring", "tracking", or
 * anything alarmist, and "waiting" never implies danger — only that the latest
 * confirmation hasn't landed yet.
 */

export type JourneyMotion =
  /** Looping, gentle "alive" motion (breathing ring, orbiting dots). */
  | "active"
  /** Slower, calmer neutral pulse — awaiting the latest update. */
  | "waiting"
  /** A brief one-shot success flourish, then still. */
  | "arrived"
  /** No animation at all. */
  | "none";

export type JourneyState = {
  /** Stable key for styling/animation selection. */
  key: "starting" | "in_transit" | "waiting" | "arrived" | "cancelled" | "expired";
  /** Short status word/phrase shown to both roles. */
  status: string;
  motion: JourneyMotion;
  /** Whether the journey is still live (controls, watcher panel, subscription). */
  isLive: boolean;
  /** Whether this is a meaningful change worth announcing via aria-live. */
  announce: boolean;
};

export type JourneyTiming = {
  expectedArrivalMs: number;
  gracePeriodMinutes: number;
  nowMs: number;
};

/**
 * Maps a canonical Safe Arrival status (plus optional timing) to its animation
 * state. Timing only refines the wording of a still-live journey ("In transit"
 * before the expected time, "Still on the way" once it's passed but within the
 * grace window); it never invents progress or movement.
 */
export function resolveJourneyState(status: SafeArrivalStatus, timing?: JourneyTiming): JourneyState {
  switch (status) {
    case "draft":
    case "pending_acknowledgement":
      return { key: "starting", status: "Starting Safe Arrival…", motion: "active", isLive: true, announce: false };

    case "active":
    case "extended": {
      const stillOnTheWay =
        timing !== undefined &&
        timing.nowMs >= timing.expectedArrivalMs &&
        timing.nowMs <
          gracePeriodEndMs({
            expectedArrivalMs: timing.expectedArrivalMs,
            gracePeriodMinutes: timing.gracePeriodMinutes
          });
      return {
        key: "in_transit",
        status: stillOnTheWay ? "Still on the way" : "In transit",
        motion: "active",
        isLive: true,
        announce: false
      };
    }

    case "grace_period":
      return { key: "in_transit", status: "Still on the way", motion: "active", isLive: true, announce: false };

    case "unconfirmed":
      // Neutral by construction: the confirmation simply hasn't arrived. Never
      // "missing", never an emergency (spec §9).
      return {
        key: "waiting",
        status: "Waiting for the latest journey update",
        motion: "waiting",
        isLive: true,
        announce: true
      };

    case "completed":
      return { key: "arrived", status: "Arrived safely", motion: "arrived", isLive: false, announce: true };

    case "cancelled":
      return { key: "cancelled", status: "Safe Arrival ended", motion: "none", isLive: false, announce: true };

    case "expired":
      return {
        key: "expired",
        status: "This Safe Arrival session has ended",
        motion: "none",
        isLive: false,
        announce: true
      };
  }
}

/**
 * Privacy-safe contact wording for the traveller, built from CANONICAL contact
 * counts rather than from a list of names.
 *
 * The rule this exists to enforce: only an ACCEPTED contact is described as
 * checking in. Counting invitations as cover is how "3 approved Muddies are
 * watching your journey" appeared for a journey where only two had accepted.
 * Names are no longer taken at all, because the visible roster can be shortened
 * by contact-identity privacy filtering and would understate the real count.
 */
export function contactStatusLine(input: { acceptedCount: number; invitedCount: number }): string {
  const { acceptedCount, invitedCount } = input;
  if (acceptedCount === 0 && invitedCount === 0) return "No Safe Arrival contacts on this journey.";
  if (acceptedCount === 0) {
    return `Waiting on ${invitedCount} ${invitedCount === 1 ? "invitation" : "invitations"}.`;
  }
  const confirmed = `${acceptedCount} confirmed`;
  return invitedCount > 0 ? `${confirmed} · ${invitedCount} awaiting response` : confirmed;
}
