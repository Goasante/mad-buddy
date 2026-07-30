import { entitlementsFor } from "@/lib/billing/entitlements";
import type {
  DropStatus,
  MomentAudienceType,
  MomentStatus,
  SubscriptionPlan
} from "@/lib/supabase/database.types";

/**
 * Moments + Drops domain core (feature architecture batch 6, spec §2-§35).
 * Pure and deterministic. Audience *eligibility* against real relationships is
 * resolved by the server service; this module owns the rules that don't need
 * I/O: tier limits, expiry, content validation, visibility precedence, and
 * Drop unlock conditions.
 */

// ---------------------------------------------------------------------------
// Tier limits (spec §16, §32, §62)
// ---------------------------------------------------------------------------

export type ContentTierLimits = {
  maxActiveMomentsPerDay: number;
  maxActiveNearbyMoments: number;
  maxActiveDrops: number;
  allowPhotoMoments: boolean;
  allowEventDrops: boolean;
};

/** Derived from the central entitlement registry (batch 10, spec §7). */
export function contentTierLimitsFor(plan: SubscriptionPlan): ContentTierLimits {
  const entitlements = entitlementsFor(plan);
  return {
    maxActiveMomentsPerDay: entitlements.max_daily_moments,
    maxActiveNearbyMoments: entitlements.max_active_nearby_moments,
    maxActiveDrops: entitlements.max_active_drops,
    allowPhotoMoments: entitlements.photo_moments,
    allowEventDrops: entitlements.event_drops
  };
}

export const CONTENT_TIER_LIMITS: Record<SubscriptionPlan, ContentTierLimits> = {
  free: contentTierLimitsFor("free"),
  buddy_plus: contentTierLimitsFor("buddy_plus"),
  buddy_pro: contentTierLimitsFor("buddy_pro")
};

// ---------------------------------------------------------------------------
// Content validation + expiry (spec §3, §6, §8)
// ---------------------------------------------------------------------------

export const MOMENT_TEXT_MAX_LENGTH = 500;
export const MOMENT_CAPTION_MAX_LENGTH = 200;

export const EXPIRY_PRESETS = [
  { id: "1h", label: "1 hour", ms: 60 * 60 * 1000 },
  { id: "3h", label: "3 hours", ms: 3 * 60 * 60 * 1000 },
  { id: "6h", label: "6 hours", ms: 6 * 60 * 60 * 1000 },
  { id: "24h", label: "24 hours", ms: 24 * 60 * 60 * 1000 }
] as const;

export type ExpiryPresetId = (typeof EXPIRY_PRESETS)[number]["id"];

/** Everything expires, the default is 6 hours (spec §8). */
export const DEFAULT_EXPIRY_MS = 6 * 60 * 60 * 1000;
export const MAX_EXPIRY_MS = 24 * 60 * 60 * 1000;

export function expiryMsForPreset(id: ExpiryPresetId): number {
  return EXPIRY_PRESETS.find((preset) => preset.id === id)?.ms ?? DEFAULT_EXPIRY_MS;
}

export function validateExpiry(expiresAtMs: number, nowMs: number): string | null {
  if (!Number.isFinite(expiresAtMs)) return "Choose when this should disappear.";
  if (expiresAtMs <= nowMs) return "Choose an expiry in the future.";
  if (expiresAtMs - nowMs > MAX_EXPIRY_MS) return "Moments can last at most 24 hours.";
  return null;
}

export type MomentContentInput = {
  contentType: "text" | "photo" | "video";
  textContent: string | null;
  mediaId: string | null;
  caption: string | null;
};

export function validateMomentContent(input: MomentContentInput): string | null {
  if (input.contentType === "text") {
    const text = input.textContent?.trim() ?? "";
    if (text.length < 1) return "Write something to share.";
    if (text.length > MOMENT_TEXT_MAX_LENGTH) {
      return `Moments are at most ${MOMENT_TEXT_MAX_LENGTH} characters.`;
    }
  } else {
    if (!input.mediaId) return input.contentType === "video" ? "Choose a video." : "Choose a photo.";
  }
  if (input.caption && input.caption.trim().length > MOMENT_CAPTION_MAX_LENGTH) {
    return `Captions are at most ${MOMENT_CAPTION_MAX_LENGTH} characters.`;
  }
  return null;
}

export function isMomentLive(status: MomentStatus, expiresAtMs: number, nowMs: number): boolean {
  return status === "active" && expiresAtMs > nowMs;
}

// ---------------------------------------------------------------------------
// Moment visibility (spec §5, §15)
// ---------------------------------------------------------------------------

export type MomentVisibilityInput = {
  isAuthor: boolean;
  status: MomentStatus;
  expiresAtMs: number;
  nowMs: number;
  areApprovedMuddies: boolean;
  isBlockedEitherDirection: boolean;
  authorGhostMode: boolean;
  /** Reporter chose "report and hide", hidden for this viewer only (§50). */
  viewerHidThis: boolean;
  audienceType: MomentAudienceType;
  /** Viewer is in the moment's explicit audience (circle/user/etc). */
  viewerInAudience: boolean;
  /** For nearby_muddies: viewer is within a privacy-safe band AND fresh (§5). */
  viewerNearbyAndFresh: boolean;
};

export type MomentVisibilityResult = {
  visible: boolean;
  reason:
    | "author"
    | "blocked"
    | "not_muddies"
    | "ghost_mode"
    | "expired"
    | "not_active"
    | "hidden_by_viewer"
    | "not_in_audience"
    | "not_nearby"
    | "visible";
};

/**
 * Decides whether a viewer may see a Moment. Strongest deny first, mirroring
 * the batch-2 precedence chain. The author always sees their own (so a hidden
 * or ghosted author isn't locked out of their own content).
 *
 * The caller must not reveal *why* something is invisible (spec §5: never
 * expose which band caused eligibility).
 */
export function resolveMomentVisibility(input: MomentVisibilityInput): MomentVisibilityResult {
  if (input.isAuthor) return { visible: true, reason: "author" };
  if (input.isBlockedEitherDirection) return { visible: false, reason: "blocked" };
  if (input.status !== "active") return { visible: false, reason: "not_active" };
  if (input.expiresAtMs <= input.nowMs) return { visible: false, reason: "expired" };
  if (input.viewerHidThis) return { visible: false, reason: "hidden_by_viewer" };
  if (input.authorGhostMode) return { visible: false, reason: "ghost_mode" };

  // Open Moments are an explicit authenticated-community audience. They never
  // depend on proximity or friendship, but every stronger safety deny above
  // still applies.
  if (input.audienceType === "public") {
    return { visible: true, reason: "visible" };
  }

  if (!input.areApprovedMuddies) return { visible: false, reason: "not_muddies" };

  // Every approved Muddy, with no further narrowing. The Muddy check above is
  // the whole audience rule, so no target rows are needed and adding a new
  // Muddy widens the audience of a live Moment automatically.
  if (input.audienceType === "all_muddies") {
    return { visible: true, reason: "visible" };
  }

  if (input.audienceType === "nearby_muddies") {
    // Nearby needs BOTH audience eligibility and a fresh, in-band presence.
    if (!input.viewerNearbyAndFresh) return { visible: false, reason: "not_nearby" };
    return { visible: true, reason: "visible" };
  }

  if (!input.viewerInAudience) return { visible: false, reason: "not_in_audience" };
  return { visible: true, reason: "visible" };
}

// ---------------------------------------------------------------------------
// Drop unlock (spec §25, §33)
// ---------------------------------------------------------------------------

export type DropUnlockInput = {
  status: DropStatus;
  startsAtMs: number;
  expiresAtMs: number;
  nowMs: number;
  areApprovedMuddiesWithCreator: boolean;
  isBlockedEitherDirection: boolean;
  /** Viewer belongs to the Drop's context (circle member / plan participant / checked in). */
  viewerInContext: boolean;
  /** Context still exists and is itself valid (§33). */
  contextValid: boolean;
  alreadyUnlocked: boolean;
  unlockCount: number;
  maxUnlocks: number | null;
};

export type DropUnlockResult = {
  allowed: boolean;
  reason:
    | "blocked"
    | "not_muddies"
    | "context_invalid"
    | "not_in_context"
    | "not_started"
    | "expired"
    | "not_active"
    | "unlock_limit_reached"
    | "already_unlocked"
    | "allowed";
};

/**
 * Whether a viewer may unlock a Drop. `already_unlocked` is NOT a failure, a
 * duplicate unlock returns the existing one (spec §33), the caller just must
 * not create a second row.
 */
export function resolveDropUnlock(input: DropUnlockInput): DropUnlockResult {
  if (input.isBlockedEitherDirection) return { allowed: false, reason: "blocked" };
  if (!input.areApprovedMuddiesWithCreator) return { allowed: false, reason: "not_muddies" };
  if (!input.contextValid) return { allowed: false, reason: "context_invalid" };
  if (!input.viewerInContext) return { allowed: false, reason: "not_in_context" };
  if (input.alreadyUnlocked) return { allowed: true, reason: "already_unlocked" };
  if (input.status !== "active" && input.status !== "scheduled") {
    return { allowed: false, reason: "not_active" };
  }
  if (input.nowMs < input.startsAtMs) return { allowed: false, reason: "not_started" };
  if (input.nowMs >= input.expiresAtMs) return { allowed: false, reason: "expired" };
  if (input.maxUnlocks !== null && input.unlockCount >= input.maxUnlocks) {
    return { allowed: false, reason: "unlock_limit_reached" };
  }
  return { allowed: true, reason: "allowed" };
}

// ---------------------------------------------------------------------------
// Privacy summary copy (spec §7)
// ---------------------------------------------------------------------------

export function audienceSummaryLabel(audienceType: MomentAudienceType, targetNames: string[]): string {
  switch (audienceType) {
    case "all_muddies":
      return "All Muddies";
    case "close_friends":
      return "Close Friends";
    case "nearby_muddies":
      return "Approved Muddies who are nearby";
    case "selected_circles":
      return targetNames.length > 0 ? targetNames.join(", ") : "Selected circles";
    case "selected_muddies":
      return targetNames.length > 0 ? targetNames.join(", ") : "Selected Muddies";
    case "event_circle":
      return "Event circle";
    case "plan":
      return "Plan participants";
    case "public":
      return "Everyone on Mad Buddy";
  }
}

/** The Spotlight audience, named for the product surface rather than the column. */
export const SPOTLIGHT_AUDIENCE_TYPE = "public" as const;

export function isSpotlightAudience(audienceType: MomentAudienceType): boolean {
  return audienceType === SPOTLIGHT_AUDIENCE_TYPE;
}

// ---------------------------------------------------------------------------
// Reactions
// ---------------------------------------------------------------------------

/**
 * The canonical reaction set, matching the `moment_reactions.reaction_type`
 * check constraint already in the database. Reused rather than extended: adding
 * emoji here without a migration would fail at insert time.
 *
 * Every reaction is POSITIVE by construction. There is no dislike, no downvote
 * and no negative score anywhere in this model, and none can be added without
 * changing the constraint. Disapproval routes to report/block, which are
 * separate systems and deliberately not part of engagement.
 */
export const MOMENT_REACTIONS = [
  { id: "heart", emoji: "❤️", label: "Love" },
  { id: "fire", emoji: "🔥", label: "Fire" },
  { id: "laugh", emoji: "😂", label: "Funny" },
  { id: "clap", emoji: "👏", label: "Applause" },
  { id: "wave", emoji: "👋", label: "Wave" }
] as const;

export type MomentReactionId = (typeof MOMENT_REACTIONS)[number]["id"];

export function reactionEmoji(id: string): string {
  return MOMENT_REACTIONS.find((reaction) => reaction.id === id)?.emoji ?? "❤️";
}

export function isSupportedReaction(id: string): id is MomentReactionId {
  return MOMENT_REACTIONS.some((reaction) => reaction.id === id);
}

/**
 * Compact aggregate presentation: the top few reactions by count, plus a total.
 * A card shows at most `limit` emoji so a busy Moment does not turn into a wall
 * of counters.
 */
export function summarizeReactions(
  breakdown: Record<string, number>,
  limit = 3
): { entries: { id: string; emoji: string; count: number }[]; total: number } {
  const entries = Object.entries(breakdown)
    .filter(([id, count]) => count > 0 && isSupportedReaction(id))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([id, count]) => ({ id, emoji: reactionEmoji(id), count }));
  const total = Object.values(breakdown).reduce((sum, count) => sum + count, 0);
  return { entries, total };
}

// ---------------------------------------------------------------------------
// Tune In
// ---------------------------------------------------------------------------

/**
 * Tune In is one-way content interest, NOT a follow graph and NOT a Muddy
 * relationship:
 *  - One-way: the creator does not tune in back, and is never told who did.
 *  - Private: only the viewer can see their own list.
 *  - Silent: no notification is produced, so there is no social pressure.
 *
 * It is deliberately independent of reactions. Reacting never tunes you in and
 * tuning in never reacts, because they answer different questions ("I liked
 * this" vs "show me more from this person").
 */
export function tuneInLabel(isTunedIn: boolean): string {
  return isTunedIn ? "Tuned In" : "Tune In";
}

/** "428 Tuned In". Never "followers", and there is no "following" counterpart. */
export function tunedInCountLabel(count: number): string {
  return `${count.toLocaleString()} Tuned In`;
}

// ---------------------------------------------------------------------------
// Spotlight ranking
// ---------------------------------------------------------------------------

export type SpotlightRankingInput = {
  momentId: string;
  createdAtMs: number;
  /** Viewer has tuned in to this creator. */
  tunedIn: boolean;
  /** Viewer and creator are approved Muddies. */
  isMuddy: boolean;
  reactionCount: number;
  viewCount: number;
};

/**
 * Blended Spotlight ranking (spec §22): tuned-in creators are boosted but never
 * take over the feed, so discovery of new creators survives.
 *
 * Recency is the base so the feed stays fresh and temporary content does not sit
 * stale at the top. Quality uses the reaction RATE rather than raw counts, so a
 * small creator with a well-received Moment can out-rank a large creator's
 * ignored one, and raw view count cannot be farmed into permanent dominance.
 *
 * Pure and deterministic: `nowMs` is passed in, never read here.
 */
export function scoreSpotlightMoment(input: SpotlightRankingInput, nowMs: number): number {
  const ageHours = Math.max(0, (nowMs - input.createdAtMs) / 3_600_000);
  // Halves roughly every 6 hours, matching the lifespan of the content.
  const recency = 1 / (1 + ageHours / 6);

  // Bounded engagement rate, so one viral Moment cannot dwarf the whole feed.
  const rate = input.viewCount > 0 ? input.reactionCount / input.viewCount : 0;
  const quality = Math.min(1, rate);

  const affinity = (input.tunedIn ? 0.35 : 0) + (input.isMuddy ? 0.15 : 0);

  // Weights: recency leads, affinity boosts, quality breaks ties. Affinity is
  // capped at 0.5 so a tuned-in creator's stale Moment still loses to a fresh
  // one from someone new.
  return recency * 1 + affinity + quality * 0.4;
}

/** Sorts a Spotlight page by blended score, highest first. */
export function rankSpotlightMoments<T extends SpotlightRankingInput>(moments: T[], nowMs: number): T[] {
  return [...moments]
    .map((moment) => ({ moment, score: scoreSpotlightMoment(moment, nowMs) }))
    .sort((a, b) => b.score - a.score || b.moment.createdAtMs - a.moment.createdAtMs)
    .map((entry) => entry.moment);
}
