import type { SubscriptionPlan, SubscriptionStatus } from "@/lib/supabase/database.types";

/**
 * THE central entitlement registry (feature architecture batch 10, spec §7-§15).
 *
 * Before this module, tier limits were defined independently in seven places
 * (visibility, plans, messaging, moments, events, safe-arrival, discovery).
 * That is exactly what spec §7 forbids: "Do not scatter subscription checks."
 * Every limit now lives here, and those modules read from this registry, so a
 * pricing change is a one-line edit rather than a hunt.
 *
 * Two rules this module enforces structurally:
 *  - Basic safety is never an entitlement. Ghost Mode, blocking, reporting,
 *    removing a Muddy, visibility control, and account deletion are absent
 *    from EntitlementKey by design, there is no key to gate them with (§1).
 *  - Privacy fails closed on downgrade (§48): losing a paid privacy feature
 *    never widens an audience.
 */

// ---------------------------------------------------------------------------
// Keys (spec §9)
// ---------------------------------------------------------------------------

export type NumericEntitlementKey =
  | "max_muddies"
  | "max_personal_circles"
  | "max_close_friends"
  | "max_active_plans"
  | "max_plan_participants"
  | "max_private_groups"
  | "max_group_members"
  | "max_daily_moments"
  | "max_active_nearby_moments"
  | "max_active_drops"
  | "max_safe_arrival_contacts"
  | "max_active_safe_arrivals"
  | "max_active_hangouts"
  | "max_hangout_capacity"
  | "max_polls_per_plan"
  | "max_voice_note_seconds"
  | "max_friend_requests_per_day"
  | "max_event_circle_members"
  | "event_circle_archive_days"
  | "plan_chat_archive_days"
  | "storage_limit_bytes";

export type BooleanEntitlementKey =
  | "advanced_visibility_schedules"
  | "recurring_plans"
  | "multiple_plan_polls"
  | "voice_notes"
  | "custom_glow_styles"
  | "friendship_recaps"
  | "event_circle_creation"
  | "event_drops"
  | "photo_moments"
  | "public_moments"
  | "qr_check_in"
  | "attendance_export"
  | "community_roles"
  | "moderation_dashboard"
  | "community_analytics"
  | "priority_support";

export type EntitlementKey = NumericEntitlementKey | BooleanEntitlementKey;

/** Internal convention for "no limit", a real number, so comparisons are total. */
export const UNLIMITED = Number.POSITIVE_INFINITY;

export type Entitlements = Record<NumericEntitlementKey, number> & Record<BooleanEntitlementKey, boolean>;

// ---------------------------------------------------------------------------
// Plan registry (spec §3, §4, §5)
// ---------------------------------------------------------------------------

const FREE: Entitlements = {
  // DEPRECATED as a paywall (Phase 0). A cap on how many friends you may
  // have is the resentment pattern, not leverage. Kept in the shape for
  // backwards compatibility and returned as UNLIMITED so every existing
  // check fails open.
  max_muddies: UNLIMITED,
  // FREE CORE (Monetization Reset). Circles are a private label you put on
  // your OWN Muddies -- organising people you already know. Paying to sort
  // your own friends into more than three groups is the resentment pattern,
  // and Circles are not one of the two paid surfaces.
  max_personal_circles: UNLIMITED,
  // Close Friends is an AUDIENCE selector, not a capacity limit: a huge
  // "close" list makes the audience meaningless rather than costing anything
  // to run. No product, privacy, performance or safety reason survived the
  // Phase 0 audit, so it is no longer monetized.
  max_close_friends: UNLIMITED,
  // FREE CORE. Plans are explicitly free under the access model: making
  // arrangements with people you already know is the existing social world.
  max_active_plans: UNLIMITED,
  // FREE CORE. A cap here would mean paying to invite the eleventh friend to
  // something you organised.
  max_plan_participants: UNLIMITED,
  // FREE CORE. Group conversations are Messages, which is free forever.
  max_private_groups: UNLIMITED,
  // FREE CORE. Same reasoning as max_plan_participants.
  max_group_members: UNLIMITED,
  // DEPRECATED as a paywall (Phase 0). See max_muddies.
  max_daily_moments: UNLIMITED,
  max_active_nearby_moments: 50,
  max_active_drops: 100,
  // SAFETY IS NEVER MONETIZED (Phase 0). Charging for a third emergency
  // contact is indefensible: the person who needs more contacts is the person
  // in more danger. Identical on every tier, and never behind a trial or a
  // payment state.
  max_safe_arrival_contacts: UNLIMITED,
  max_active_safe_arrivals: UNLIMITED,
  max_active_hangouts: 3,
  max_hangout_capacity: 50,
  // FREE CORE. A poll is how a Plan gets decided; it belongs to Plans.
  max_polls_per_plan: UNLIMITED,
  max_voice_note_seconds: 300,
  // DEAD KEY (Phase 0 audit). Real anti-spam enforcement is the rate limiter's
  // "friends.request" rule (10/day, in lib/security/rate-limit.ts), which is
  // uniform across tiers and returns neutral rate-limit copy. This entitlement
  // is read only by REQUEST_LIMITS in lib/discovery/trust.ts, which nothing
  // enforces. Kept in the shape for compatibility and made uniform so it can
  // never be reintroduced as a paid difference.
  max_friend_requests_per_day: 30,
  // FREE CORE. Events are free under the access model.
  max_event_circle_members: UNLIMITED,
  // FREE CORE. A tiered archive window means paying to keep your own history,
  // which is the same class of pattern as charging to read old messages.
  event_circle_archive_days: UNLIMITED,
  // FREE CORE. Plan chat is Messages. Paying to keep a conversation you
  // already had is exactly what the continuity rule forbids.
  plan_chat_archive_days: UNLIMITED,
  storage_limit_bytes: 50 * 1024 * 1024 * 1024,

  advanced_visibility_schedules: true,
  recurring_plans: true,
  multiple_plan_polls: true,
  // Voice notes stay on Free: accessibility is never paywalled (spec §45 b7).
  voice_notes: true,
  custom_glow_styles: true,
  friendship_recaps: true,
  event_circle_creation: true,
  event_drops: true,
  photo_moments: true,
  // Core Air publishing is part of the free product (Phase 0): a network
  // effect that only paying users can contribute to starves itself. Advanced
  // Air (scheduling, analytics, boost, creator tools) remains a future paid
  // opportunity behind its own keys.
  public_moments: true,
  qr_check_in: true,
  attendance_export: true,
  community_roles: false,
  moderation_dashboard: false,
  community_analytics: false,
  priority_support: false
};

const BUDDY_PLUS: Entitlements = { ...FREE };

const BUDDY_PRO: Entitlements = { ...FREE };

export const PLAN_ENTITLEMENTS: Record<SubscriptionPlan, Entitlements> = {
  free: FREE,
  buddy_plus: BUDDY_PLUS,
  buddy_pro: BUDDY_PRO
};

// ---------------------------------------------------------------------------
// Billing state → effective plan (spec §10, §58, §59)
// ---------------------------------------------------------------------------

/**
 * Statuses that still grant paid access. `past_due` and `attention` do: a
 * failed renewal enters a grace period during which the user keeps their
 * features (spec §61), and `non_renewing` means cancelled-but-paid-through.
 */
const PAID_ACCESS_STATUSES: ReadonlySet<SubscriptionStatus> = new Set<SubscriptionStatus>([
  "active",
  "trialing",
  "non_renewing",
  "past_due",
  "attention"
]);

/**
 * How long paid access survives a failed renewal (spec §61). The webhook sets
 * `grace_ends_at` from this when Paystack reports a payment failure.
 */
export const GRACE_PERIOD_DAYS = 7;

export type BillingState = {
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  /** End of the paid period / grace window, if any. */
  periodEndMs: number | null;
  graceEndsMs: number | null;
  /** Separate, server-verified trial access. Never persisted as a subscription. */
  trialId?: string | null;
  trialPlan?: Exclude<SubscriptionPlan, "free"> | null;
  trialStartedAtMs?: number | null;
  trialEndsAtMs?: number | null;
  /** Earned access is independent of subscriptions and trials. */
  earnedRewardId?: string | null;
  earnedPlan?: Exclude<SubscriptionPlan, "free"> | null;
  earnedStartsAtMs?: number | null;
  earnedEndsAtMs?: number | null;
  earnedGraceEndsAtMs?: number | null;
};

/**
 * The plan actually in force right now. A grace period keeps paid access until
 * it expires; after that the subject falls back to free (§62). Expiry is
 * evaluated against the server clock the caller passes in.
 */
export function effectivePlan(state: BillingState, nowMs: number): SubscriptionPlan {
  if (state.plan !== "free" && PAID_ACCESS_STATUSES.has(state.status)) {
    const graceExpired = state.graceEndsMs !== null && nowMs > state.graceEndsMs;
    const periodExpired =
      state.graceEndsMs === null &&
      state.periodEndMs !== null &&
      nowMs > state.periodEndMs &&
      state.status !== "active" &&
      state.status !== "trialing";
    if (!graceExpired && !periodExpired) return state.plan;
  }

  const trialIsActive =
    Boolean(state.trialId && state.trialPlan) &&
    state.trialStartedAtMs !== null &&
    state.trialStartedAtMs !== undefined &&
    state.trialEndsAtMs !== null &&
    state.trialEndsAtMs !== undefined &&
    state.trialStartedAtMs <= nowMs &&
    state.trialEndsAtMs > nowMs;
  if (trialIsActive) return state.trialPlan ?? "free";
  const earnedIsActive =
    Boolean(state.earnedRewardId && state.earnedPlan) &&
    (state.earnedStartsAtMs ?? Number.POSITIVE_INFINITY) <= nowMs &&
    ((state.earnedEndsAtMs ?? 0) > nowMs || (state.earnedGraceEndsAtMs ?? 0) > nowMs);
  return earnedIsActive ? (state.earnedPlan ?? "free") : "free";
}

export function billingAccessSource(state: BillingState, nowMs: number): "subscription" | "trial" | "earned" | "free" {
  const plan = effectivePlan(state, nowMs);
  if (plan === "free") return "free";
  const trialActive =
    state.trialId &&
    state.trialPlan === plan &&
    state.trialStartedAtMs !== null &&
    state.trialStartedAtMs !== undefined &&
    state.trialEndsAtMs !== null &&
    state.trialEndsAtMs !== undefined &&
    state.trialStartedAtMs <= nowMs &&
    state.trialEndsAtMs > nowMs;
  const paidActive =
    effectivePlan(
      {
        ...state,
        trialId: null,
        trialPlan: null,
        trialStartedAtMs: null,
        trialEndsAtMs: null,
        earnedRewardId: null,
        earnedPlan: null,
        earnedStartsAtMs: null,
        earnedEndsAtMs: null,
        earnedGraceEndsAtMs: null
      },
      nowMs
    ) !== "free";
  if (paidActive) return "subscription";
  if (trialActive) return "trial";
  return state.earnedRewardId && state.earnedPlan === plan ? "earned" : "free";
}

export type EntitlementOverride = {
  key: EntitlementKey;
  value: number | boolean;
  startsAtMs: number | null;
  endsAtMs: number | null;
};

/**
 * Resolves the full entitlement set for a subject (spec §10). Overrides are
 * applied last and only while in-window, so an expired promotional grant
 * silently stops applying rather than lingering.
 */
export function resolveEntitlements(input: {
  state: BillingState;
  overrides?: EntitlementOverride[];
  nowMs: number;
}): Entitlements {
  const plan = effectivePlan(input.state, input.nowMs);
  const base = { ...entitlementsFor(plan) };

  for (const override of input.overrides ?? []) {
    const started = override.startsAtMs === null || override.startsAtMs <= input.nowMs;
    const notEnded = override.endsAtMs === null || override.endsAtMs > input.nowMs;
    if (!started || !notEnded) continue;
    // Types are validated at the write boundary; here we trust the stored kind.
    (base as Record<string, number | boolean>)[override.key] = override.value;
  }

  return base;
}

export function entitlementsFor(_plan: SubscriptionPlan): Entitlements {
  // Historical plan names remain readable, but never decide live consumer capability.
  return PLAN_ENTITLEMENTS.free;
}

// ---------------------------------------------------------------------------
// Checks (spec §12)
// ---------------------------------------------------------------------------

export function checkFeature(entitlements: Entitlements, key: BooleanEntitlementKey): boolean {
  return entitlements[key] === true;
}

export type UsageCheck = {
  allowed: boolean;
  limit: number;
  current: number;
  remaining: number;
};

/**
 * Whether `current + requested` fits under a numeric limit. Used before the
 * protected operation, never after (spec §12).
 */
export function checkUsageLimit(input: {
  entitlements: Entitlements;
  key: NumericEntitlementKey;
  current: number;
  requested?: number;
}): UsageCheck {
  const limit = input.entitlements[input.key];
  const requested = input.requested ?? 1;
  const remaining = limit === UNLIMITED ? UNLIMITED : Math.max(0, limit - input.current);
  return {
    allowed: input.current + requested <= limit,
    limit,
    current: input.current,
    remaining
  };
}

export function isUnlimited(value: number): boolean {
  return value === UNLIMITED;
}

/** JSON can't carry Infinity, the API convention is null for unlimited (§14). */
export function serializeLimit(value: number): number | null {
  return value === UNLIMITED ? null : value;
}

// ---------------------------------------------------------------------------
// Upgrade prompts (spec §37)
// ---------------------------------------------------------------------------

/**
 * Contextual, specific copy, never "Upgrade now to continue using Mad Buddy".
 * States the actual limit hit and what the upgrade actually gives.
 */
export function upgradePromptFor(_key: NumericEntitlementKey, _currentPlan: SubscriptionPlan): string | null {
  return null;
}

// ---------------------------------------------------------------------------
// Safe downgrade fallback (spec §46, §48), privacy fails closed.
// ---------------------------------------------------------------------------

export type OverLimitResource =
  | "personal_circles"
  | "close_friends"
  | "private_groups"
  | "active_plans"
  | "storage";

export type OverLimitItem = {
  resource: OverLimitResource;
  current: number;
  newLimit: number;
  /** How many the user must pick to keep. */
  keepCount: number;
  excess: number;
};

/**
 * What exceeds the target plan's limits. Used to show the user what they must
 * choose BEFORE the downgrade applies, nothing is deleted (spec §45).
 */
export function resolveOverLimits(input: {
  targetPlan: SubscriptionPlan;
  usage: Partial<Record<OverLimitResource, number>>;
}): OverLimitItem[] {
  const entitlements = entitlementsFor(input.targetPlan);
  const pairs: Array<[OverLimitResource, NumericEntitlementKey]> = [
    ["personal_circles", "max_personal_circles"],
    ["close_friends", "max_close_friends"],
    ["private_groups", "max_private_groups"],
    ["active_plans", "max_active_plans"],
    ["storage", "storage_limit_bytes"]
  ];

  const items: OverLimitItem[] = [];
  for (const [resource, key] of pairs) {
    const current = input.usage[resource] ?? 0;
    const limit = entitlements[key];
    if (limit === UNLIMITED || current <= limit) continue;
    items.push({ resource, current, newLimit: limit, keepCount: limit, excess: current - limit });
  }
  return items;
}

export type SafeFallback = {
  /** Where a paid privacy configuration must land when it expires. */
  glowAudience: "hidden";
  advancedSchedulesEnabled: false;
  reason: string;
};

/**
 * When a paid privacy configuration becomes unavailable, fall back to the
 * SAFER state, never the broader one (spec §48). Losing advanced scheduling
 * must never silently promote someone to "All Muddies".
 */
export function safePrivacyFallback(): SafeFallback {
  return {
    glowAudience: "hidden",
    advancedSchedulesEnabled: false,
    reason: "Advanced visibility schedules ended, so your glow is hidden until you choose a new audience."
  };
}

/** Data is never destroyed by a downgrade, only restricted (spec §42, §45). */
export const DOWNGRADE_NEVER_DELETES = [
  "friendships",
  "messages",
  "circle_membership",
  "media",
  "plans"
] as const;
