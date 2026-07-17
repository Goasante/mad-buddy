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

/** Everything expires — the default is 6 hours (spec §8). */
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
  contentType: "text" | "photo";
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
    if (!input.mediaId) return "Choose a photo.";
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
  /** Reporter chose "report and hide" — hidden for this viewer only (§50). */
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
  if (!input.areApprovedMuddies) return { visible: false, reason: "not_muddies" };
  if (input.status !== "active") return { visible: false, reason: "not_active" };
  if (input.expiresAtMs <= input.nowMs) return { visible: false, reason: "expired" };
  if (input.viewerHidThis) return { visible: false, reason: "hidden_by_viewer" };
  if (input.authorGhostMode) return { visible: false, reason: "ghost_mode" };

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
 * Whether a viewer may unlock a Drop. `already_unlocked` is NOT a failure — a
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
  }
}
