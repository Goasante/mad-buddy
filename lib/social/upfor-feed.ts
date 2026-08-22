import { PROXIMITY_BAND_LABELS, type ProximityBand } from "@/lib/proximity/bands";
import type { SocializeAreaTier } from "@/lib/social/socialize";
import type { HangoutActivityType } from "@/lib/supabase/database.types";

/**
 * The UpFor feed: discovery modes, proximity wording, social proof, momentum.
 *
 * Pure data in, pure data out. No React, no Supabase, no clock of its own --
 * `nowMs` is always passed in -- so every rule here is testable without a DOM
 * or a database, which is the point: these are the rules that decide what a
 * person is allowed to see and what the product claims about distance.
 *
 * WHAT THIS IS NOT. It is not an audience authority. Eligibility is decided
 * server-side by canViewHangout before anything reaches this module; a
 * discovery mode only ever NARROWS an already-eligible list. Filtering here
 * could never be a privacy control, because the row would already have been
 * sent to the client.
 */

// ---------------------------------------------------------------------------
// Discovery modes
// ---------------------------------------------------------------------------

/**
 * The four tabs on the approved screen.
 *
 * These are ways of BROWSING, deliberately separate from `audience_type`,
 * which is who may see an UpFor at all. The distinction matters: an UpFor
 * posted to all Muddies can appear under "Muddies" and under "For You"; one
 * posted to a public Group appears under "Groups" for a member. Making these
 * database enum values would have fused the two ideas and left no way to ask
 * "who may see this" independently of "where am I looking".
 */
export type UpForMode = "for_you" | "muddies" | "around" | "groups";

export const UPFOR_MODES: ReadonlyArray<{ id: UpForMode; label: string }> = [
  { id: "for_you", label: "For You" },
  { id: "muddies", label: "Muddies" },
  { id: "around", label: "Around" },
  { id: "groups", label: "Groups" }
];

export function isUpForMode(value: string): value is UpForMode {
  return UPFOR_MODES.some((mode) => mode.id === value);
}

// ---------------------------------------------------------------------------
// Proximity wording
// ---------------------------------------------------------------------------

/**
 * The coarse tier an UpFor carries, widened to a Glow V2 band.
 *
 * UpFor stores three tiers; Glow V2 names six bands. Mapping three onto six
 * means choosing, for each tier, which band it may honestly claim -- and the
 * only safe direction is OUTWARD. `close_by` maps to "Close By" rather than
 * "Right Here" or "Just Around", because a tier that merely means "the closest
 * of three buckets" cannot support a claim of being metres away. Overstating
 * closeness is the failure that matters here; understating it is merely vague.
 *
 * The labels themselves are never written out. They come from
 * PROXIMITY_BAND_LABELS, so if Glow V2 renames a band this follows rather than
 * drifting into a second vocabulary.
 */
const TIER_TO_BAND: Record<SocializeAreaTier, ProximityBand> = {
  close_by: "close_by",
  nearby: "nearby",
  wider_area: "around_town"
};

/**
 * What the card says about where somebody is, or null for silence.
 *
 * Null when the tier is absent -- the creator's position was unknown or too
 * old. Silence is the correct answer: the alternative is inventing a band, and
 * "Across Town" would be as much a fabrication as "Right Here".
 *
 * NEVER a distance. No metres, no kilometres, no coordinates. The approved
 * mockup shows "2.4 km away"; that single element of it is deliberately not
 * reproduced.
 */
export function upForProximityLabel(areaTier: SocializeAreaTier | null): string | null {
  if (!areaTier) return null;
  return PROXIMITY_BAND_LABELS[TIER_TO_BAND[areaTier]] ?? null;
}

// ---------------------------------------------------------------------------
// Social proof
// ---------------------------------------------------------------------------

export type UpForSocialProof = {
  /** People to draw, already privacy-filtered by the caller. */
  visible: ReadonlyArray<{ userId: string; name: string; avatarUrl: string | null }>;
  /** How many more exist than are drawn. Never negative. */
  overflow: number;
  /** "2 are in", "1 is in", or null when nobody has joined yet. */
  label: string | null;
};

/** How many faces a card draws before collapsing the rest into "+n". */
export const SOCIAL_PROOF_LIMIT = 3;

/**
 * The avatar stack and its caption.
 *
 * `goingCount` is the server's count of accepted joiners INCLUDING the owner;
 * `participants` excludes the owner. The caption counts joiners rather than
 * attendees, so a fresh UpFor with only its creator reads as no label at all
 * rather than "1 is in" -- which would otherwise suggest somebody had
 * responded when nobody has.
 *
 * The overflow number is derived from the same filtered list the faces come
 * from, never from a raw database count: if a participant was withheld from
 * this viewer, they must not reappear as part of a "+3".
 */
export function upForSocialProof(input: {
  participants: ReadonlyArray<{ userId: string; name: string; avatarUrl: string | null }>;
  limit?: number;
}): UpForSocialProof {
  const limit = input.limit ?? SOCIAL_PROOF_LIMIT;
  const joiners = input.participants;
  const visible = joiners.slice(0, limit);
  const overflow = Math.max(0, joiners.length - visible.length);

  const label =
    joiners.length === 0 ? null : joiners.length === 1 ? "1 is in" : `${joiners.length} are in`;

  return { visible, overflow, label };
}

// ---------------------------------------------------------------------------
// Momentum
// ---------------------------------------------------------------------------

/**
 * How much real interest has gathered.
 *
 * DERIVED, NEVER STORED. There is no momentum column and no history table: the
 * value is a function of the joiners an UpFor has right now and how long it has
 * left. The approved illustration shows a rising curve, which is decoration --
 * the product behaviour it stands for is simply "enough people said yes that
 * this should become a Plan", and a count answers that without a time series.
 */
export type UpForMomentum = "quiet" | "growing" | "strong";

/**
 * Joiners needed before the creator is offered a Plan.
 *
 * Two, excluding the creator: three people total is the smallest group where
 * "shall we make this a plan" is a real question rather than a conversation
 * between two people who could just message each other.
 */
export const MOMENTUM_PLAN_THRESHOLD = 2;

export function upForMomentum(input: {
  /** Accepted joiners, excluding the owner. */
  joinerCount: number;
  endsAt: string;
  nowMs: number;
}): UpForMomentum {
  // An UpFor that has ended has no momentum, whatever it gathered.
  if (Date.parse(input.endsAt) <= input.nowMs) return "quiet";
  if (input.joinerCount >= MOMENTUM_PLAN_THRESHOLD) return "strong";
  if (input.joinerCount >= 1) return "growing";
  return "quiet";
}

/**
 * Whether to offer the creator "Looks like a plan".
 *
 * Only to the OWNER, only while live, and only with real joiners. A viewer
 * seeing this on somebody else's card would be an invitation to act on a
 * decision that is not theirs.
 */
export function shouldOfferPlanConversion(input: {
  isOwner: boolean;
  joinerCount: number;
  endsAt: string;
  nowMs: number;
  status: string;
}): boolean {
  if (!input.isOwner) return false;
  if (input.status !== "active" && input.status !== "full") return false;
  return upForMomentum(input) === "strong";
}

/** "4 people are up for food tonight." -- the sentence under the prompt. */
export function planConversionSummary(input: {
  joinerCount: number;
  activityLabel: string;
}): string {
  // +1 for the creator: the sentence counts everybody who would be there.
  const total = input.joinerCount + 1;
  return `${total} ${total === 1 ? "person is" : "people are"} up for ${input.activityLabel.toLowerCase()}.`;
}

// ---------------------------------------------------------------------------
// Ranking: "For You"
// ---------------------------------------------------------------------------

export type RankableUpFor = {
  id: string;
  ownerId: string;
  activityType: HangoutActivityType;
  areaTier: SocializeAreaTier | null;
  startsAt: string;
  endsAt: string;
  goingCount: number;
  /** Whether the viewer and the creator are approved Muddies. */
  isMuddy: boolean;
  /** Whether this reached the viewer through a Group they are in. */
  viaGroup: boolean;
};

/**
 * Score an eligible UpFor for the default feed.
 *
 * "For You" must not be an alias for "everything", so this orders the same
 * eligible set rather than widening it. Every input is already known to the
 * viewer -- a relationship they formed, a group they joined, a timestamp, a
 * count -- so nothing here profiles anybody or needs to be stored.
 *
 * Deterministic on purpose: same inputs, same order, so the ranking can be
 * tested rather than eyeballed.
 */
export function upForRelevanceScore(item: RankableUpFor, nowMs: number): number {
  let score = 0;

  // A Muddy's UpFor outranks a stranger's. This is the strongest signal
  // because it is the one the viewer actually chose.
  if (item.isMuddy) score += 100;

  // Reaching the viewer through a group they joined is a weaker but real
  // relationship -- weaker than friendship, stronger than mere proximity.
  if (item.viaGroup) score += 40;

  /* Real participation. Capped, so a busy UpFor cannot bury every quieter one
   * beneath it -- the feed should show what is happening, not only what is
   * already crowded. */
  score += Math.min(item.goingCount, 5) * 8;

  // Closeness, where it is known. Absent tier scores nothing rather than
  // being penalised: unknown is not the same as far away.
  if (item.areaTier === "close_by") score += 24;
  else if (item.areaTier === "nearby") score += 14;
  else if (item.areaTier === "wider_area") score += 6;

  /* Freshness, decaying over six hours. UpFor is about right now, so an hour
   * old should outrank five hours old even when everything else matches. */
  const ageMs = Math.max(0, nowMs - Date.parse(item.startsAt));
  const ageHours = ageMs / (60 * 60 * 1000);
  score += Math.max(0, 30 - ageHours * 5);

  // Ending soon sinks: offering something with minutes left wastes the tap.
  const remainingMs = Date.parse(item.endsAt) - nowMs;
  if (remainingMs < 15 * 60 * 1000) score -= 40;

  return score;
}

/**
 * Order an already-eligible list for a discovery mode.
 *
 * Ties break on id so the order is stable across renders -- a feed that
 * reshuffles identical-scoring cards on every poll looks broken.
 */
export function rankForYou<T extends RankableUpFor>(items: readonly T[], nowMs: number): T[] {
  return [...items].sort((a, b) => {
    const diff = upForRelevanceScore(b, nowMs) - upForRelevanceScore(a, nowMs);
    return diff !== 0 ? diff : a.id.localeCompare(b.id);
  });
}

/**
 * Narrow an eligible list to one mode.
 *
 * NARROWING ONLY. Every item passed here has already cleared the server's
 * audience check; a mode decides which of those the viewer is currently
 * looking at. "around" deliberately keeps items with no tier: an unknown
 * position is not evidence of being far away, and dropping them would hide
 * real UpFors for a reason the data does not support.
 */
export function filterForMode<T extends RankableUpFor>(
  items: readonly T[],
  mode: UpForMode,
  nowMs: number
): T[] {
  switch (mode) {
    case "muddies":
      return items.filter((item) => item.isMuddy);
    case "groups":
      return items.filter((item) => item.viaGroup);
    case "around":
      return items.filter((item) => !item.isMuddy || item.areaTier !== null);
    case "for_you":
    default:
      return rankForYou(items, nowMs);
  }
}

// ---------------------------------------------------------------------------
// Empty states
// ---------------------------------------------------------------------------

/**
 * What each tab says when it has nothing.
 *
 * Each is written to claim only what the system actually knows. "Around"
 * matters most: the app knows that no eligible live UpFor came back, which is
 * not the same as knowing there is nobody nearby -- and saying the latter
 * would be both wrong and a little bleak.
 */
export function upForEmptyCopy(mode: UpForMode): { title: string; body: string } {
  switch (mode) {
    case "muddies":
      return {
        title: "None of your Muddies are UpFor anything",
        body: "When one of them says what they are up for, it shows up here."
      };
    case "around":
      return {
        title: "Nothing live around you right now",
        body: "This only shows UpFors you can join. Start one and see who is in."
      };
    case "groups":
      return {
        title: "No UpFors in your groups",
        body: "Anything posted to a group you are in will appear here."
      };
    case "for_you":
    default:
      return {
        title: "Nothing happening yet",
        body: "Say what you are up for and see who is in."
      };
  }
}
