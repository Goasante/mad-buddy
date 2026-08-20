/**
 * Linkr eligibility, ranking and copy. Pure and deterministic -- no database,
 * no clock of its own, no `server-only`.
 *
 * The point of keeping this pure is that the privacy rules become testable as
 * rules rather than as query results. `isCandidateEligible` is the single
 * predicate the server query is required to agree with, so a mutation that
 * weakens it fails a test rather than silently widening discovery.
 */

import { areIntentsCompatible, type LinkrIntent } from "@/lib/linkr/intent";

/** The tiers the canonical proximity engine already produces. */
export type LinkrProximityTier = "close" | "near" | "far";

/** What the user picks. Never a number, in the model or on the screen. */
export type LinkrDistancePreference = "very_close" | "around_you" | "wider";

export const LINKR_DISTANCE_OPTIONS: ReadonlyArray<{
  id: LinkrDistancePreference;
  label: string;
  hint: string;
}> = [
  { id: "very_close", label: "Very close", hint: "People right around you" },
  { id: "around_you", label: "Around you", hint: "People in your area" },
  { id: "wider", label: "Wider", hint: "People a bit further away" }
];

/**
 * Preference to admitted tiers. Composed with the existing proximity
 * authority rather than replacing it: Linkr never computes a distance, it
 * only says which of the tiers that engine already returns it will accept.
 */
export const DISTANCE_TIERS: Record<LinkrDistancePreference, ReadonlyArray<LinkrProximityTier>> = {
  very_close: ["close"],
  around_you: ["close", "near"],
  wider: ["close", "near", "far"]
};

/** The label a candidate card shows. Broad language, by design. */
export const PROXIMITY_LABELS: Record<LinkrProximityTier, string> = {
  close: "Very close",
  near: "Around you",
  far: "A bit further"
};

/**
 * Event Mode labels. Same tiers, different words: at an Event the useful
 * distinction is "in this room" rather than "in this city".
 */
export const EVENT_PROXIMITY_LABELS: Record<LinkrProximityTier, string> = {
  close: "Here too",
  near: "Around the event",
  far: "At the event"
};

export function proximityLabel(tier: LinkrProximityTier, eventMode: boolean): string {
  return eventMode ? EVENT_PROXIMITY_LABELS[tier] : PROXIMITY_LABELS[tier];
}

export const LINKR_MINIMUM_AGE = 18;

// ---------------------------------------------------------------------------
// Discoverability -- may this person be shown to anyone at all?
// ---------------------------------------------------------------------------

export type DiscoverabilityInput = {
  linkrEnabled: boolean;
  age: number | null;
  hasPrimaryPhoto: boolean;
  accountVisible: boolean;
  restricted: boolean;
  deleted: boolean;
};

export type DiscoverabilityResult = {
  discoverable: boolean;
  reason:
    | "discoverable"
    | "linkr_disabled"
    | "no_age"
    | "underage"
    | "no_photo"
    | "account_hidden"
    | "restricted"
    | "deleted";
};

/**
 * FAILS CLOSED on every unknown. A missing date of birth is not "probably an
 * adult", it is "we do not know", and an 18+ surface may not guess. Likewise a
 * profile with no primary photo is not shown: the card would be a silhouette,
 * which is neither useful to look at nor safe to be represented by.
 */
export function resolveDiscoverability(input: DiscoverabilityInput): DiscoverabilityResult {
  if (input.deleted) return { discoverable: false, reason: "deleted" };
  if (input.restricted) return { discoverable: false, reason: "restricted" };
  if (!input.linkrEnabled) return { discoverable: false, reason: "linkr_disabled" };
  if (input.age === null) return { discoverable: false, reason: "no_age" };
  if (input.age < LINKR_MINIMUM_AGE) return { discoverable: false, reason: "underage" };
  if (!input.accountVisible) return { discoverable: false, reason: "account_hidden" };
  if (!input.hasPrimaryPhoto) return { discoverable: false, reason: "no_photo" };
  return { discoverable: true, reason: "discoverable" };
}

/**
 * What the owner still has to do before Linkr will show them to anyone.
 *
 * Deliberately short. Over-gating an early user is how a discovery product
 * ends up with an empty pool, so this asks for the two things a card cannot be
 * drawn without -- an age we can verify and a face -- and nothing else. A bio
 * and interests improve ranking; their absence does not block.
 */
export function missingProfileRequirements(input: {
  age: number | null;
  hasPrimaryPhoto: boolean;
}): string[] {
  const missing: string[] = [];
  if (input.age === null) missing.push("Add your date of birth");
  else if (input.age < LINKR_MINIMUM_AGE) missing.push("Linkr is for people 18 and over");
  if (!input.hasPrimaryPhoto) missing.push("Add a main photo");
  return missing;
}

/**
 * What activation still needs, as a STRUCTURE rather than a list of sentences.
 *
 * The prose form above described the gates accurately and gave the UI nothing
 * to act on, so a missing date of birth rendered as a paragraph -- text that
 * looked like an instruction and could not be tapped, leaving Continue
 * permanently disabled with no way forward. A caller now learns WHICH gate is
 * open and can put the matching control on screen.
 *
 * `underage` is deliberately distinct from `needsDateOfBirth`: one is a step
 * the person can complete, the other is an answer they cannot change, and
 * showing them the same way would either hide a real refusal or nag somebody
 * who has simply not filled a field in yet.
 */
export type ActivationRequirements = {
  needsDateOfBirth: boolean;
  underage: boolean;
  needsPhoto: boolean;
  /** True only when every gate this screen owns is satisfied. */
  canActivate: boolean;
  /**
   * What is outstanding, as ONE sentence naming everything missing.
   *
   * Deliberately a single message with a single Profile destination rather
   * than a step per gate: both a photo and a date of birth belong to Profile,
   * so two separate prompts would send somebody to the same screen twice.
   */
  profileMessage: string | null;
};

/**
 * What activation still needs -- all of it owned by PROFILE.
 *
 * Linkr collects neither a date of birth nor a photo. It reads the canonical
 * profile picture and the canonical derived age, and when either is missing it
 * hands the person to Profile rather than growing an identity form of its own.
 * That boundary is the whole point: Linkr should not ask people to rebuild an
 * identity Mad Buddy already has.
 */
export function resolveActivationRequirements(input: {
  age: number | null;
  hasPrimaryPhoto: boolean;
}): ActivationRequirements {
  const needsDateOfBirth = input.age === null;
  const underage = input.age !== null && input.age < LINKR_MINIMUM_AGE;
  const needsPhoto = !input.hasPrimaryPhoto;

  // Underage is an answer, not an outstanding task, so it carries no
  // "complete your profile" instruction -- there is nothing to complete.
  const missing: string[] = [];
  if (!underage && needsPhoto) missing.push("a profile photo");
  if (!underage && needsDateOfBirth) missing.push("your date of birth");

  const profileMessage =
    missing.length === 0
      ? null
      : `Add ${missing.join(" and ")} in your profile before using Linkr.`;

  return {
    needsDateOfBirth,
    underage,
    needsPhoto,
    canActivate: !needsDateOfBirth && !underage && !needsPhoto,
    profileMessage
  };
}

/** Heading for the Profile handoff. One destination, one instruction. */
export const LINKR_PROFILE_HANDOFF_TITLE = "Finish your profile first";
export const LINKR_PROFILE_HANDOFF_CTA = "Complete profile";

/** Shown when the person is under 18. A product state, not a form error. */
export const LINKR_UNDERAGE_MESSAGE = "Linkr is available to people 18 and older.";

// ---------------------------------------------------------------------------
// Candidate eligibility -- may THIS viewer be shown THIS person?
// ---------------------------------------------------------------------------

export type CandidateEligibilityInput = {
  /** Both directions. A block is symmetric regardless of who pressed it. */
  blockedEitherDirection: boolean;
  /** The candidate's own discoverability, already resolved. */
  candidateDiscoverable: boolean;
  viewerIntent: LinkrIntent;
  candidateIntent: LinkrIntent;
  tier: LinkrProximityTier;
  allowedTiers: ReadonlyArray<LinkrProximityTier>;
  /** A live pass or connect this viewer already recorded. */
  alreadyActedOn: boolean;
  alreadyConnected: boolean;
  isSelf: boolean;
  /** Their location is stale enough that "nearby" would be a claim we cannot make. */
  presenceExpired: boolean;
  /** Optional viewer filters, each backed by real data. */
  requirePhotos: boolean;
  candidateHasShowcasePhotos: boolean;
  onlyActiveNow: boolean;
  candidateActiveNow: boolean;
  onlyNewToday: boolean;
  candidateJoinedToday: boolean;
  /** Event Mode only: the Events side said this attendee is eligible. */
  eventModeActive: boolean;
  eventEligible: boolean;
};

export type CandidateEligibilityResult = {
  eligible: boolean;
  reason:
    | "eligible"
    | "self"
    | "blocked"
    | "not_discoverable"
    | "intent_mismatch"
    | "out_of_range"
    | "already_acted"
    | "already_connected"
    | "presence_expired"
    | "filtered_photos"
    | "filtered_active"
    | "filtered_new"
    | "not_event_eligible";
};

/**
 * ELIGIBILITY IS EVALUATED BEFORE RANKING, AND THE ORDER INSIDE IT MATTERS.
 *
 * Blocks are checked before anything else that could be interesting, and
 * before any filter a viewer could relax. There is no arrangement of settings,
 * no widened distance and no score that lets a blocked person through, because
 * the block is answered first and returns immediately.
 *
 * The optional filters come last, after the safety rules, so that "show me
 * fewer people" can never accidentally be the thing that admits someone.
 */
export function isCandidateEligible(input: CandidateEligibilityInput): CandidateEligibilityResult {
  if (input.isSelf) return { eligible: false, reason: "self" };
  if (input.blockedEitherDirection) return { eligible: false, reason: "blocked" };
  if (!input.candidateDiscoverable) return { eligible: false, reason: "not_discoverable" };

  // Event Mode narrows; it never widens. A candidate must be eligible for
  // ordinary Linkr first and eligible for the Event as well.
  if (input.eventModeActive && !input.eventEligible) {
    return { eligible: false, reason: "not_event_eligible" };
  }

  if (input.alreadyConnected) return { eligible: false, reason: "already_connected" };
  if (input.alreadyActedOn) return { eligible: false, reason: "already_acted" };
  if (!areIntentsCompatible(input.viewerIntent, input.candidateIntent)) {
    return { eligible: false, reason: "intent_mismatch" };
  }
  if (!input.allowedTiers.includes(input.tier)) return { eligible: false, reason: "out_of_range" };
  if (input.presenceExpired) return { eligible: false, reason: "presence_expired" };

  if (input.requirePhotos && !input.candidateHasShowcasePhotos) {
    return { eligible: false, reason: "filtered_photos" };
  }
  if (input.onlyActiveNow && !input.candidateActiveNow) {
    return { eligible: false, reason: "filtered_active" };
  }
  if (input.onlyNewToday && !input.candidateJoinedToday) {
    return { eligible: false, reason: "filtered_new" };
  }

  return { eligible: true, reason: "eligible" };
}

// ---------------------------------------------------------------------------
// Ranking -- ordering, applied only to people already found eligible.
// ---------------------------------------------------------------------------

export type RankingInput = {
  tier: LinkrProximityTier;
  sharedInterests: number;
  intentExactMatch: boolean;
  photoCount: number;
  hasBio: boolean;
  activeNow: boolean;
  joinedRecently: boolean;
};

const TIER_SCORE: Record<LinkrProximityTier, number> = { close: 30, near: 18, far: 8 };

/**
 * A small, explainable score. Every term is something a user would recognise
 * as a reason they were shown somebody -- nearer, more in common, a fuller
 * profile, actually around. There is deliberately no term for how long you
 * have been scrolling, how many people you passed, or anything else whose only
 * purpose would be to keep you here longer.
 */
export function rankCandidate(input: RankingInput): number {
  let score = TIER_SCORE[input.tier];
  score += Math.min(input.sharedInterests, 5) * 6;
  if (input.intentExactMatch) score += 10;
  score += Math.min(input.photoCount, 4) * 3;
  if (input.hasBio) score += 4;
  if (input.activeNow) score += 8;
  if (input.joinedRecently) score += 5;
  return score;
}

// ---------------------------------------------------------------------------
// Copy. Centralised so product wording changes without touching architecture.
// ---------------------------------------------------------------------------

export const LINKR_COPY = {
  offTitle: "Meet people who are open to connecting.",
  offPrivacy: "Your exact location is never shown.",
  turnOn: "Turn on Linkr",
  howItWorks: "How Linkr works",
  activationTitle: "Turn on Linkr?",
  activationPoints: [
    "Only people who are also open to connecting can see you.",
    "We never show your exact location.",
    "You're always in control."
  ],
  intentPrompt: "I'm here for",
  activationFootnote: "You can change this anytime.",
  matchTitle: "You clicked!",
  matchBody: (name: string) => `You and ${name} both want to connect.`,
  sayHi: "Say hi",
  keepDiscovering: "Keep discovering",
  emptyTitle: "No one nearby right now",
  emptyBody: "Check back later or widen your search.",
  widenSearch: "Widen search",
  connectedThroughLinkr: "Connected through Linkr",
  connectedAtEvent: (eventName: string) => `Connected at ${eventName}`,
  eventIntroTitle: "Meet people here",
  eventIntroBody: "People shown here are checked in and open to connecting.",
  eventBrowse: "Browse people here"
} as const;

/** The four points on the education screen. */
export const HOW_LINKR_WORKS: ReadonlyArray<{ title: string; body: string }> = [
  {
    title: "You choose to be visible",
    body: "Only people who turn on Linkr can discover you."
  },
  {
    title: "We protect your location",
    body: "We show general proximity, never exact location."
  },
  {
    title: "You're in control",
    body: "Block, hide or report anytime. You decide."
  },
  {
    title: "It's mutual",
    body: "You only connect when both of you are interested."
  }
];
