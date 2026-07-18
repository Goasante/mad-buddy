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
  max_muddies: 30,
  max_personal_circles: 3,
  max_close_friends: 8,
  max_active_plans: 5,
  max_plan_participants: 10,
  max_private_groups: 3,
  max_group_members: 15,
  max_daily_moments: 5,
  max_active_nearby_moments: 1,
  max_active_drops: 3,
  max_safe_arrival_contacts: 2,
  max_active_safe_arrivals: 3,
  max_active_hangouts: 3,
  max_hangout_capacity: 5,
  max_polls_per_plan: 1,
  max_voice_note_seconds: 60,
  max_friend_requests_per_day: 20,
  max_event_circle_members: 50,
  event_circle_archive_days: 7,
  plan_chat_archive_days: 7,
  storage_limit_bytes: 500 * 1024 * 1024,

  advanced_visibility_schedules: false,
  recurring_plans: false,
  multiple_plan_polls: false,
  // Voice notes stay on Free: accessibility is never paywalled (spec §45 b7).
  voice_notes: true,
  custom_glow_styles: false,
  friendship_recaps: false,
  event_circle_creation: false,
  event_drops: false,
  photo_moments: true,
  qr_check_in: false,
  attendance_export: false,
  community_roles: false,
  moderation_dashboard: false,
  community_analytics: false,
  priority_support: false
};

const BUDDY_PLUS: Entitlements = {
  ...FREE,
  max_muddies: 150,
  max_personal_circles: UNLIMITED,
  max_close_friends: 30,
  max_active_plans: UNLIMITED,
  max_plan_participants: 50,
  max_private_groups: 20,
  max_group_members: 50,
  max_daily_moments: 20,
  max_active_nearby_moments: 5,
  max_active_drops: 20,
  max_safe_arrival_contacts: 5,
  max_hangout_capacity: 50,
  max_polls_per_plan: UNLIMITED,
  max_voice_note_seconds: 300,
  max_friend_requests_per_day: 50,
  max_event_circle_members: 250,
  event_circle_archive_days: 30,
  plan_chat_archive_days: 30,
  storage_limit_bytes: 5 * 1024 * 1024 * 1024,

  advanced_visibility_schedules: true,
  recurring_plans: true,
  multiple_plan_polls: true,
  custom_glow_styles: true,
  friendship_recaps: true,
  event_circle_creation: true,
  event_drops: true
};

const BUDDY_PRO: Entitlements = {
  ...BUDDY_PLUS,
  max_muddies: UNLIMITED,
  max_close_friends: 100,
  max_plan_participants: 500,
  max_private_groups: 100,
  max_group_members: 1000,
  max_daily_moments: 100,
  max_active_nearby_moments: 20,
  max_active_drops: 100,
  max_event_circle_members: 5000,
  event_circle_archive_days: 90,
  plan_chat_archive_days: 90,
  storage_limit_bytes: 50 * 1024 * 1024 * 1024,

  qr_check_in: true,
  attendance_export: true,
  community_roles: true,
  moderation_dashboard: true,
  community_analytics: true,
  priority_support: true
};

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
};

/**
 * The plan actually in force right now. A grace period keeps paid access until
 * it expires; after that the subject falls back to free (§62). Expiry is
 * evaluated against the server clock the caller passes in.
 */
export function effectivePlan(state: BillingState, nowMs: number): SubscriptionPlan {
  if (state.plan === "free") return "free";
  if (!PAID_ACCESS_STATUSES.has(state.status)) return "free";

  // A grace window, once elapsed, ends paid access even if the provider
  // status hasn't caught up yet.
  if (state.graceEndsMs !== null && nowMs > state.graceEndsMs) return "free";
  // A lapsed period with no grace window also ends access.
  if (
    state.graceEndsMs === null &&
    state.periodEndMs !== null &&
    nowMs > state.periodEndMs &&
    state.status !== "active" &&
    state.status !== "trialing"
  ) {
    return "free";
  }
  return state.plan;
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
  const base = { ...PLAN_ENTITLEMENTS[plan] };

  for (const override of input.overrides ?? []) {
    const started = override.startsAtMs === null || override.startsAtMs <= input.nowMs;
    const notEnded = override.endsAtMs === null || override.endsAtMs > input.nowMs;
    if (!started || !notEnded) continue;
    // Types are validated at the write boundary; here we trust the stored kind.
    (base as Record<string, number | boolean>)[override.key] = override.value;
  }

  return base;
}

export function entitlementsFor(plan: SubscriptionPlan): Entitlements {
  return PLAN_ENTITLEMENTS[plan] ?? PLAN_ENTITLEMENTS.free;
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
export function upgradePromptFor(key: NumericEntitlementKey, currentPlan: SubscriptionPlan): string | null {
  if (currentPlan !== "free") return null;
  switch (key) {
    case "max_personal_circles":
      return "Free includes 3 circles. Buddy Plus includes unlimited personal circles.";
    case "max_close_friends":
      return "Free includes 8 Close Friends. Buddy Plus includes 30.";
    case "max_plan_participants":
      return "Free plans include up to 10 people. Buddy Plus includes up to 50.";
    case "max_active_plans":
      return "Free includes 5 active plans. Buddy Plus includes unlimited plans.";
    case "max_group_members":
      return "Free groups include up to 15 people. Buddy Plus includes up to 50.";
    case "max_daily_moments":
      return "Free includes 5 Moments a day. Buddy Plus includes 20.";
    case "max_muddies":
      return "Free includes 30 Muddies. Buddy Plus includes 150.";
    case "max_active_drops":
      return "Free includes 3 active Drops. Buddy Plus includes 20.";
    case "max_hangout_capacity":
      return "Free hangouts include up to 5 people. Buddy Plus includes up to 50.";
    case "max_polls_per_plan":
      return "Free includes one poll per plan. Buddy Plus includes unlimited polls.";
    default:
      return null;
  }
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
