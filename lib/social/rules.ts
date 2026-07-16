import type {
  ActivityType,
  AvailabilityType,
  PingResponseType,
  PingStatus,
  PingType
} from "@/lib/supabase/database.types";

/**
 * Pure domain rules for Muddy Status, Wave, and Meeting Ping.
 * Everything here is server-enforced policy (feature spec §11, §20, §36,
 * §40-41): the client never decides eligibility, cooldowns, or state
 * transitions. Kept pure so the privacy- and race-critical logic is unit
 * tested (see rules.test.ts).
 */

// ---------------------------------------------------------------------------
// Status (spec §3-§4)
// ---------------------------------------------------------------------------

export const AVAILABILITY_TYPES: readonly AvailabilityType[] = [
  "free",
  "open_to_hang_out",
  "maybe_available",
  "busy",
  "do_not_disturb"
];

export const ACTIVITY_TYPES: readonly ActivityType[] = [
  "studying",
  "working",
  "eating",
  "at_an_event",
  "exercising",
  "gaming",
  "travelling",
  "heading_home",
  "relaxing"
];

export const availabilityLabels: Record<AvailabilityType, string> = {
  free: "Free",
  open_to_hang_out: "Open to hang out",
  maybe_available: "Maybe available",
  busy: "Busy",
  do_not_disturb: "Do not disturb"
};

export const activityLabels: Record<ActivityType, string> = {
  studying: "Studying",
  working: "Working",
  eating: "Eating",
  at_an_event: "At an event",
  exercising: "Exercising",
  gaming: "Gaming",
  travelling: "Travelling",
  heading_home: "Heading home",
  relaxing: "Relaxing"
};

export const STATUS_MAX_TEXT_LENGTH = 60;
export const STATUS_MAX_DURATION_MS = 24 * 60 * 60 * 1000;
export const STATUS_DEFAULT_DURATION_MS = 2 * 60 * 60 * 1000;

export const STATUS_DURATION_PRESETS = [
  { id: "30m", label: "30 minutes", ms: 30 * 60 * 1000 },
  { id: "1h", label: "1 hour", ms: 60 * 60 * 1000 },
  { id: "2h", label: "2 hours", ms: STATUS_DEFAULT_DURATION_MS },
  { id: "4h", label: "4 hours", ms: 4 * 60 * 60 * 1000 },
  { id: "tonight", label: "Until tonight", ms: -1 } // resolved to 23:59 local by caller
] as const;

export function validateStatusExpiry(expiresAtMs: number, nowMs: number): string | null {
  if (!Number.isFinite(expiresAtMs)) return "Choose a valid expiry time.";
  if (expiresAtMs <= nowMs) return "Status expiry must be in the future.";
  if (expiresAtMs - nowMs > STATUS_MAX_DURATION_MS) {
    return "A status can last at most 24 hours.";
  }
  return null;
}

export function isStatusActive(status: { expires_at: string }, nowMs: number): boolean {
  return Date.parse(status.expires_at) > nowMs;
}

/**
 * Server-side visibility floor (spec §6): mutual friendship required, no
 * blocks, unexpired, and — because a visible status can indirectly reveal
 * activity — Ghost Mode hides status by default (spec §7).
 */
export function canViewStatus(input: {
  areMutualMuddies: boolean;
  isBlockedEitherDirection: boolean;
  ownerVisibilityStatus: "visible" | "ghost" | "app_open_only";
  statusExpiresAtMs: number;
  nowMs: number;
}): boolean {
  return (
    input.areMutualMuddies &&
    !input.isBlockedEitherDirection &&
    input.ownerVisibilityStatus !== "ghost" &&
    input.statusExpiresAtMs > input.nowMs
  );
}

// ---------------------------------------------------------------------------
// Wave (spec §20-§21)
// ---------------------------------------------------------------------------

export const WAVE_PAIR_COOLDOWN_MS = 30 * 60 * 1000;
export const WAVE_ACTIVE_WINDOW_MS = 24 * 60 * 60 * 1000;

export function wavePairCooldownRemaining(lastWaveSentAtMs: number | null, nowMs: number): number {
  if (lastWaveSentAtMs === null) return 0;
  return Math.max(0, lastWaveSentAtMs + WAVE_PAIR_COOLDOWN_MS - nowMs);
}

// ---------------------------------------------------------------------------
// Meeting Ping (spec §31, §35-§36)
// ---------------------------------------------------------------------------

export const PING_TYPES: readonly PingType[] = ["meet", "food", "study", "chat", "walk", "custom"];

export const pingTypeLabels: Record<PingType, string> = {
  meet: "Want to meet?",
  food: "Food?",
  study: "Study together?",
  chat: "Quick chat?",
  walk: "Walk?",
  custom: "Custom"
};

export const PING_MAX_MESSAGE_LENGTH = 180;
export const PING_MAX_PLACE_LENGTH = 80;

/** Expiry per proposed lead time (spec §35). */
export function pingExpiryMs(proposedTimeMs: number, nowMs: number): number {
  const leadMs = proposedTimeMs - nowMs;
  if (leadMs <= 5 * 60 * 1000) return nowMs + 20 * 60 * 1000; // "Now"
  if (leadMs <= 15 * 60 * 1000) return nowMs + 30 * 60 * 1000;
  if (leadMs <= 30 * 60 * 1000) return nowMs + 45 * 60 * 1000;
  if (leadMs <= 60 * 60 * 1000) return nowMs + 90 * 60 * 1000;
  // Later today / custom: expire at the proposed time itself.
  return proposedTimeMs;
}

/**
 * The full transition table (spec §36). Anything not listed is invalid and
 * must be rejected server-side.
 */
const PING_TRANSITIONS: Record<PingStatus, readonly PingStatus[]> = {
  pending: ["seen", "accepted", "declined", "maybe", "cancelled", "expired"],
  seen: ["accepted", "declined", "maybe", "counter_proposed", "cancelled", "expired"],
  maybe: ["accepted", "declined", "counter_proposed", "cancelled", "expired"],
  counter_proposed: ["accepted", "declined", "cancelled", "expired"],
  accepted: ["completed", "cancelled"],
  declined: [],
  cancelled: [],
  expired: [],
  completed: []
};

export function canTransitionPing(from: PingStatus, to: PingStatus): boolean {
  return PING_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Which party may drive a given transition (spec §37, §40). */
export function pingActorAllowed(input: {
  transition: PingStatus;
  actorIsSender: boolean;
  actorIsRecipient: boolean;
}): boolean {
  const { transition, actorIsSender, actorIsRecipient } = input;

  if (!actorIsSender && !actorIsRecipient) return false;

  switch (transition) {
    case "seen":
    case "maybe":
    case "declined":
      return actorIsRecipient;
    case "counter_proposed":
      // Recipient counters a pending/seen/maybe ping. (Sender re-proposing is
      // modelled as cancel + new ping in the MVP.)
      return actorIsRecipient;
    case "accepted":
      // Recipient accepts an offer; sender accepts a counter-proposal. Callers
      // enforce that split with the current status; either party is eligible.
      return true;
    case "cancelled":
      return actorIsSender;
    case "completed":
      return true;
    default:
      return false;
  }
}

export function responseTypeToStatus(response: PingResponseType): PingStatus | null {
  switch (response) {
    case "accept":
      return "accepted";
    case "maybe":
      return "maybe";
    case "decline":
      return "declined";
    case "counter_propose":
      return "counter_proposed";
    default:
      return null;
  }
}

export function isPingExpired(ping: { expires_at: string; status: PingStatus }, nowMs: number): boolean {
  if (["accepted", "completed", "cancelled", "declined", "expired"].includes(ping.status)) {
    return ping.status === "expired";
  }
  return Date.parse(ping.expires_at) <= nowMs;
}
