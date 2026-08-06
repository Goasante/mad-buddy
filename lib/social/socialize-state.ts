/**
 * Socialize display state — one resolver, one answer.
 *
 * Pure: no React, no data access. It maps the inputs the page already holds
 * (session, people, in-flight flags, connectivity, permission) onto exactly
 * one display state, so the radar and the People Nearby list can never
 * disagree — "radar says empty while list says error" is unrepresentable
 * because both read the same resolved value.
 *
 * The precedence below is deliberate and ordered from "cannot proceed at all"
 * down to "working normally".
 */

export type SocializeDisplayState =
  /** Socialize is off. The radar and centre remain; nothing is discovered. */
  | "inactive"
  /** Turning on: the session is being created. */
  | "activating"
  /** On, first load, nobody rendered yet. */
  | "loading"
  /** On, with people to show. */
  | "populated"
  /** On, confirmed nobody nearby. */
  | "empty"
  /** On, refreshing while existing people stay on screen. */
  | "refreshing"
  /** A discovery request failed. Distinct from empty. */
  | "failed"
  /** No connectivity: the last confirmed state is preserved, not claimed live. */
  | "offline"
  /** Location permission is missing, so discovery cannot run. */
  | "permission"
  /** The session ended while the user was on the screen. */
  | "expired";

export type SocializeStateInput = {
  /** A session exists and has not passed its expiry. Server-derived. */
  isActive: boolean;
  /** A session existed during this visit but has since expired. */
  justExpired: boolean;
  /** An activation request is in flight. */
  activating: boolean;
  /** Any discovery request is in flight. */
  loading: boolean;
  /** The last discovery request failed. */
  failed: boolean;
  /** The browser reports no connectivity. */
  offline: boolean;
  /** Location permission is known to be denied. */
  permissionDenied: boolean;
  /** How many authorised people are currently held. */
  peopleCount: number;
};

/**
 * Resolve the single display state.
 *
 * Order matters:
 *  1. Expiry and permission are terminal — no amount of retrying helps until
 *     the user acts, so they outrank transient states.
 *  2. Offline outranks failure: "you are offline" is more useful and more
 *     honest than "the request failed".
 *  3. A failure only surfaces when there is nothing to show. With people still
 *     on screen a background refresh that failed must not blank the radar —
 *     the caller keeps showing what it last confirmed.
 */
export function resolveSocializeState(input: SocializeStateInput): SocializeDisplayState {
  // A session that ended is reported even though isActive is now false, so the
  // user is told what happened rather than silently dropped to "off".
  if (input.justExpired) return "expired";

  // Nothing can be discovered without location, so this outranks activation.
  if (input.permissionDenied) return "permission";

  if (input.activating) return "activating";
  if (!input.isActive) return "inactive";

  // Active from here down.
  if (input.offline) return "offline";

  if (input.peopleCount > 0) {
    // Existing people stay on screen through both a refresh and a failed
    // refresh: clearing them would present a transient network problem as
    // "nobody is nearby".
    return input.loading ? "refreshing" : "populated";
  }

  if (input.failed) return "failed";
  if (input.loading) return "loading";
  return "empty";
}

/** Whether this state should render the people it holds. */
export function showsPeople(state: SocializeDisplayState): boolean {
  return state === "populated" || state === "refreshing";
}

/** Whether the server can be reached for actions right now. */
export function allowsServerActions(state: SocializeDisplayState): boolean {
  return state !== "offline" && state !== "permission" && state !== "expired";
}

/** Whether a retry action is meaningful in this state. */
export function offersRetry(state: SocializeDisplayState): boolean {
  return state === "failed";
}

export type SocializeStateCopy = {
  /** The message shown in the radar field. Null when nothing needs saying. */
  message: string | null;
  /** A supporting line, where one helps. */
  detail: string | null;
  /** The label of the action offered alongside, if any. */
  action: string | null;
};

/**
 * Copy for each state.
 *
 * One place, so the radar and the list say the same thing. Nothing here
 * mentions why access changed, and nothing implies location is broken when the
 * simple truth is that nobody is around.
 */
export function socializeStateCopy(state: SocializeDisplayState): SocializeStateCopy {
  switch (state) {
    case "inactive":
      return {
        message: "Socialize is off.",
        detail: "Turn it on to meet people nearby.",
        action: null
      };
    case "activating":
      return { message: "Getting Socialize ready…", detail: null, action: null };
    case "loading":
      return { message: "Looking for people nearby…", detail: null, action: null };
    case "empty":
      return {
        message: "No one nearby right now.",
        detail: "Keep Socializing on and check again soon.",
        action: "Refresh"
      };
    case "failed":
      return {
        message: "We couldn’t refresh nearby people.",
        detail: null,
        action: "Try again"
      };
    case "offline":
      return {
        message: "You’re offline.",
        detail: "Nearby people will refresh when you reconnect.",
        action: null
      };
    case "permission":
      return {
        // Says what is needed and why, without OS text and without implying
        // an exact position is shared.
        message: "Location access is needed for Socialize.",
        detail: "Mad Buddy uses it to work out who is near you — never your exact location.",
        action: "Review settings"
      };
    case "expired":
      return {
        message: "Your Socialize session ended.",
        detail: null,
        action: "Start again"
      };
    default:
      // populated / refreshing: the people themselves are the content.
      return { message: null, detail: null, action: null };
  }
}

/**
 * Whether this state warrants a screen-reader announcement.
 *
 * Deliberately excludes "refreshing": background refreshes happen often, and
 * announcing each one would make the screen unusable with a screen reader.
 */
export function announcesState(state: SocializeDisplayState): boolean {
  return state === "failed" || state === "offline" || state === "permission" || state === "expired";
}
