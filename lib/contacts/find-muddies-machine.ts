/**
 * The Find Your Muddies state machine.
 *
 * WHY A MACHINE AND NOT BOOLEANS. The sheet previously tracked stage, matches,
 * an error string and two pending flags separately, and the combinations that
 * could not happen were only prevented by the order the code happened to run
 * in. That is how the sheet ended up able to show an error underneath a
 * results list, and how "unsupported" became a terminal screen with two
 * buttons, one of which did nothing.
 *
 * Every state below is a screen someone can actually be looking at, every
 * transition is a thing they can actually do, and a transition that is not
 * listed cannot happen. Being pure, all of it is testable without a DOM, a
 * picker or a network.
 *
 * THE ORDERING RULE THIS ENFORCES: the OS contact picker is reachable ONLY
 * from `choose` in SUPPORTED_READY, which is itself reachable only from a tap
 * in INTRO. Opening the sheet cannot request contacts, and neither can the
 * reminder that opens it -- a system permission dialog nobody asked for is one
 * people refuse, and refusing it is sticky.
 */

export type FindMuddiesState =
  /** The explanation. Always the first screen, and always the way back. */
  | { name: "INTRO" }
  /**
   * This device can read contacts, and the person has read why. The picker
   * opens from here and nowhere else.
   */
  | { name: "SUPPORTED_READY" }
  /** No contact access on this platform. Offers search and invite instead. */
  | { name: "UNSUPPORTED" }
  /** The OS picker is open. Cancelling comes back to SUPPORTED_READY. */
  | { name: "SELECTING" }
  /** Numbers submitted, waiting on the server. */
  | { name: "MATCHING" }
  | { name: "RESULTS"; matches: readonly ContactMatchView[] }
  /** Matched successfully, nobody found. A distinct screen, not empty RESULTS. */
  | { name: "NO_RESULTS" }
  /**
   * Something failed. Carries whether retrying is meaningful: a network blip
   * is worth another tap, a daily limit is not.
   */
  | { name: "ERROR"; message: string; retry: RetryTarget };

/**
 * What "Try again" should do, decided when the error is created rather than
 * guessed at the button.
 *
 * `null` means retrying cannot help, so no retry button is offered -- a
 * "Try again" that always fails is worse than no button at all.
 */
export type RetryTarget = "choose" | "match" | null;

/**
 * The row shape the results list renders.
 *
 * Structurally the server projection, declared here rather than imported so
 * this module stays free of `server-only` and can be unit tested directly.
 */
export type ContactMatchView = {
  userId: string;
  displayName: string;
  username: string;
  avatarUrl: string | null;
  isVerifiedAccount: boolean;
  trustedSince: string | null;
  plan: string;
  relationship: "none" | "requested" | "incoming" | "muddies";
};

export type FindMuddiesEvent =
  /** Sheet opened. Always lands on the explanation. */
  | { type: "open" }
  /** "Find my Muddies" on the explanation screen. */
  | { type: "begin"; supported: boolean }
  /** "Choose contacts". The only event that may reach the OS picker. */
  | { type: "choose" }
  /** The picker returned numbers. */
  | { type: "selected" }
  /** The picker was dismissed, or held nothing usable. Not an error. */
  | { type: "cancelled" }
  | { type: "matched"; matches: readonly ContactMatchView[] }
  | { type: "failed"; message: string; retry: RetryTarget }
  /** "Try again" on an error screen. */
  | { type: "retry" }
  /** "Back". Every screen has one route out that is not "close". */
  | { type: "back" };

export const INITIAL_STATE: FindMuddiesState = { name: "INTRO" };

/**
 * The single transition function.
 *
 * Unlisted pairs return the current state unchanged rather than throwing: a
 * duplicate tap or a late response arriving after the user moved on must be
 * ignored, not crash a sheet somebody is using.
 */
export function findMuddiesReducer(state: FindMuddiesState, event: FindMuddiesEvent): FindMuddiesState {
  switch (event.type) {
    case "open":
      return INITIAL_STATE;

    case "begin":
      // Capability is checked HERE, on a deliberate tap, and not while
      // rendering the explanation -- so the screen someone reads is the same
      // one on every device, and the difference appears only once they act.
      if (state.name !== "INTRO") return state;
      return event.supported ? { name: "SUPPORTED_READY" } : { name: "UNSUPPORTED" };

    case "choose":
      // THE ONLY DOOR TO THE PICKER.
      if (state.name !== "SUPPORTED_READY") return state;
      return { name: "SELECTING" };

    case "selected":
      if (state.name !== "SELECTING") return state;
      return { name: "MATCHING" };

    case "cancelled":
      // Closing the picker is a normal choice: back to the screen that opened
      // it, with no error and above all no second permission prompt.
      if (state.name !== "SELECTING") return state;
      return { name: "SUPPORTED_READY" };

    case "matched":
      if (state.name !== "MATCHING") return state;
      return event.matches.length > 0
        ? { name: "RESULTS", matches: event.matches }
        : { name: "NO_RESULTS" };

    case "failed":
      // Reachable from either working state, since selection and matching can
      // both fail, and from RESULTS -- an "Add Muddy" that fails is reported
      // inline there rather than replacing the list.
      if (state.name !== "SELECTING" && state.name !== "MATCHING") return state;
      return { name: "ERROR", message: event.message, retry: event.retry };

    case "retry":
      if (state.name !== "ERROR") return state;
      // Returns to the step that failed, so retrying does not make somebody
      // read the explanation again.
      if (state.retry === "choose") return { name: "SUPPORTED_READY" };
      if (state.retry === "match") return { name: "SUPPORTED_READY" };
      return state;

    case "back":
      // NO STATE STRANDS ANYONE. Every screen that is not the explanation
      // returns to it; the explanation itself is closed by the sheet's own
      // dismiss, which is the platform gesture people already expect.
      return state.name === "INTRO" ? state : INITIAL_STATE;

    default:
      return state;
  }
}

/** Whether this state offers a Back control. INTRO closes instead. */
export function showsBack(state: FindMuddiesState): boolean {
  return state.name !== "INTRO" && state.name !== "MATCHING" && state.name !== "SELECTING";
}

/**
 * Whether the OS picker may be invoked right now.
 *
 * A second guard beside the reducer, checked by the component immediately
 * before it calls the capability layer. Cheap, and it means a future edit that
 * wires a picker call to the wrong handler fails a test rather than shipping a
 * permission prompt nobody asked for.
 */
export function mayOpenPicker(state: FindMuddiesState, event: FindMuddiesEvent): boolean {
  return event.type === "choose" && state.name === "SUPPORTED_READY";
}
