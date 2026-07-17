import { entitlementsFor } from "@/lib/billing/entitlements";
import type { SubscriptionPlan, VisibilityMode } from "@/lib/supabase/database.types";

/**
 * Pure visibility-resolution and tier rules for Circles, Circle Visibility,
 * and Close Friends (feature batch 2). This is the security-critical core of
 * the shared permission service (spec §53): every "can this viewer see this
 * feature" decision routes through resolveFeatureAccess so the privacy logic
 * lives in exactly one tested place, never duplicated across routes.
 */

// ---------------------------------------------------------------------------
// Tier limits (spec §4, §38)
// ---------------------------------------------------------------------------

export type TierLimits = {
  maxPersonalCircles: number; // Infinity = unlimited
  maxCircleMembers: number;
  maxCloseFriends: number;
};

/**
 * Derived from the central entitlement registry (batch 10, spec §7) rather
 * than declared here. This shape is kept for the existing callers; the numbers
 * now have exactly one home.
 */
export function tierLimitsFor(plan: SubscriptionPlan): TierLimits {
  const entitlements = entitlementsFor(plan);
  return {
    maxPersonalCircles: entitlements.max_personal_circles,
    // Circle member cap tracks the group-member entitlement.
    maxCircleMembers: plan === "free" ? 20 : plan === "buddy_plus" ? 100 : Infinity,
    maxCloseFriends: entitlements.max_close_friends
  };
}

export const TIER_LIMITS: Record<SubscriptionPlan, TierLimits> = {
  free: tierLimitsFor("free"),
  buddy_plus: tierLimitsFor("buddy_plus"),
  buddy_pro: tierLimitsFor("buddy_pro")
};

// ---------------------------------------------------------------------------
// Circle naming (spec §6)
// ---------------------------------------------------------------------------

export const CIRCLE_NAME_MAX_LENGTH = 40;

export function validateCircleName(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length < 1) return "Give your circle a name.";
  if (trimmed.length > CIRCLE_NAME_MAX_LENGTH) {
    return `Circle names are at most ${CIRCLE_NAME_MAX_LENGTH} characters.`;
  }
  if (/[<>]/.test(trimmed)) return "Circle names can't contain < or >.";
  return null;
}

// ---------------------------------------------------------------------------
// Feature access resolution (spec §23, §24, §25)
// ---------------------------------------------------------------------------

export type ActiveVisibilitySession = {
  visibilityMode: VisibilityMode;
  /** Circle ids the session grants access to (include). */
  includedCircleIds: ReadonlySet<string>;
  endsAtMs: number | null;
};

export type FeatureAccessInput = {
  areMutualMuddies: boolean;
  isBlockedEitherDirection: boolean;
  ownerGhostMode: boolean;
  ownerSuspended: boolean;
  viewerIsCloseFriend: boolean;
  /** Circle ids (owned by the owner) that the viewer is a member of. */
  viewerCircleIds: ReadonlySet<string>;
  /** True when the owner explicitly excluded this specific viewer (spec §25). */
  viewerExplicitlyExcluded: boolean;
  /** The owner's active session for this feature, or null if none. */
  session: ActiveVisibilitySession | null;
  nowMs: number;
};

export type FeatureAccessResult = {
  allowed: boolean;
  reason:
    | "blocked"
    | "suspended"
    | "not_muddies"
    | "ghost_mode"
    | "explicitly_excluded"
    | "hidden"
    | "session_expired"
    | "not_in_audience"
    | "allowed";
};

/**
 * Resolves whether `viewer` may see `owner`'s feature, applying the full
 * precedence chain from spec §24 (strongest deny first). When the owner has
 * no active visibility session, the default is the pre-existing behavior:
 * any mutual, unblocked, non-ghosted Muddy may see them.
 */
export function resolveFeatureAccess(input: FeatureAccessInput): FeatureAccessResult {
  // 1. Block — strongest deny.
  if (input.isBlockedEitherDirection) return { allowed: false, reason: "blocked" };
  // 2. Suspension.
  if (input.ownerSuspended) return { allowed: false, reason: "suspended" };
  // Relationship gate — no status for non-Muddies, ever.
  if (!input.areMutualMuddies) return { allowed: false, reason: "not_muddies" };
  // 3. Ghost Mode overrides everything below, including Close Friends (spec §48).
  if (input.ownerGhostMode) return { allowed: false, reason: "ghost_mode" };

  // 4. Explicit user exclusion overrides any inclusion (spec §24, §25).
  if (input.viewerExplicitlyExcluded) return { allowed: false, reason: "explicitly_excluded" };

  const session = input.session;

  // No active session → default: all mutual Muddies may see.
  if (!session) return { allowed: true, reason: "allowed" };

  if (!sessionApplies(session, input.nowMs)) {
    return { allowed: false, reason: "session_expired" };
  }

  // 5. Hidden mode.
  if (session.visibilityMode === "hidden") return { allowed: false, reason: "hidden" };

  // 7/8/9/10. Audience resolution.
  switch (session.visibilityMode) {
    case "all_muddies":
      return { allowed: true, reason: "allowed" };
    case "close_friends":
      return input.viewerIsCloseFriend
        ? { allowed: true, reason: "allowed" }
        : { allowed: false, reason: "not_in_audience" };
    case "selected_circles": {
      const inAudience = [...input.viewerCircleIds].some((id) => session.includedCircleIds.has(id));
      return inAudience
        ? { allowed: true, reason: "allowed" }
        : { allowed: false, reason: "not_in_audience" };
    }
    default:
      return { allowed: false, reason: "not_in_audience" };
  }
}

function sessionApplies(session: ActiveVisibilitySession, nowMs: number): boolean {
  return session.endsAtMs === null || session.endsAtMs > nowMs;
}
