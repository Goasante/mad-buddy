import "server-only";

import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { ExperimentPlatform, SubscriptionPlan } from "@/lib/supabase/database.types";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export const OPEN_MOMENTS_FLAG = "open_moments" as const;
export const SOCIALIZE_FLAG = "socialize" as const;

/**
 * Scope reduction: features paused for the first release.
 *
 * DELIBERATELY OFF, not accidentally unreachable. Both keys have no row in
 * feature_flags, and resolveGlobalFeatureFlag fails closed on a missing row,
 * so absent == off. No migration exists to hide UI; creating database state
 * purely to switch something off would be state we then have to maintain.
 *
 * MOMENTS_FLAG is DISTINCT from OPEN_MOMENTS_FLAG and deliberately broader.
 * open_moments gates only the PUBLIC Open feed (audience_type === 'public');
 * Muddies-only Moments bypass it entirely. Reusing it here would have left
 * private Moments fully live while appearing to pause the feature.
 *
 * Re-enable either one from Admin -> Features, or locally by seeding a row:
 *   insert into feature_flags (key, status, default_value)
 *   values ('moments', 'on', true);
 */
export const MOMENTS_FLAG = "moments" as const;
export const MAD_CAM_FLAG = "mad_cam" as const;

/**
 * Life (Phase 3). Flags control EXISTENCE; entitlements control ACCESS.
 *
 * Keeping them separate is what makes a feature killable after it has been
 * sold: an entitlement says who may use a thing, a flag says whether the
 * thing runs at all. Conflating them means a paying user's feature cannot be
 * switched off without appearing to revoke what they bought.
 *
 * Every Life flag is OFF until approved, and none is entitlement-gated in
 * this phase — the foundation ships dark.
 */
export const LIFE_TIMELINE_FLAG = "life_timeline" as const;
export const LIFE_RELATIONSHIP_NOTES_FLAG = "life_relationship_notes" as const;
export const LIFE_RECONNECT_FLAG = "life_reconnect" as const;
export const LIFE_BIRTHDAYS_FLAG = "life_birthdays" as const;
export const LIFE_MILESTONES_FLAG = "life_milestones" as const;

/** Every Life flag, for tests and admin listing. */
export const LIFE_FLAGS = [
  LIFE_TIMELINE_FLAG,
  LIFE_RELATIONSHIP_NOTES_FLAG,
  LIFE_RECONNECT_FLAG,
  LIFE_BIRTHDAYS_FLAG,
  LIFE_MILESTONES_FLAG
] as const;

export const MANAGED_FEATURES = [
  {
    key: MOMENTS_FLAG,
    title: "Moments",
    category: "Social discovery",
    description: "Short-lived posts members share with their Muddies, and the Moments surfaces around them.",
    enabledImpact: "Moments returns to navigation, Home, profiles and Quick Actions, and members can post again.",
    disabledImpact:
      "Every Moments surface is hidden and new posts, reactions and views are blocked. Existing Moments and their media are kept and keep their normal expiry."
  },
  {
    key: MAD_CAM_FLAG,
    title: "Mad Cam",
    category: "Media",
    description: "The in-app camera for capturing photos and short videos.",
    enabledImpact: "The camera launcher returns to the app shell.",
    disabledImpact:
      "The camera launcher is hidden. Ordinary photo and file attachments in chat are unaffected -- they do not use Mad Cam."
  },
  {
    key: OPEN_MOMENTS_FLAG,
    title: "Open Moments",
    category: "Social discovery",
    description: "Authenticated members can view public Moments and Buddy Pro members can publish them.",
    enabledImpact: "The Open feed becomes visible to signed-in members. Only eligible Buddy Pro members can publish.",
    disabledImpact: "The Open feed is hidden and new public posts are blocked. Stored posts keep their normal expiry."
  },
  {
    key: SOCIALIZE_FLAG,
    title: "Linkr",
    category: "Social discovery",
    description: "Lets members opt in briefly to discover other nearby people who are also open to connecting.",
    enabledImpact: "Socialize appears in navigation and members can start or update an opt-in session.",
    disabledImpact: "Socialize is hidden and new sessions, updates, and discovery requests are blocked."
  },
  {
    key: LIFE_TIMELINE_FLAG,
    title: "Relationship timeline",
    category: "Life",
    description: "A private, per-person history of factual moments shared with a Muddy.",
    enabledImpact: "Members can view their own timeline for a relationship. Each side sees only what they are authorised to.",
    disabledImpact: "Timelines are hidden. The underlying factual events are still recorded and can be shown later."
  },
  {
    key: LIFE_RELATIONSHIP_NOTES_FLAG,
    title: "Relationship notes",
    category: "Life",
    description: "Private notes a member writes about a relationship. Never visible to the other person.",
    enabledImpact: "Members can write, edit and delete their own notes.",
    disabledImpact: "Notes are hidden and no new notes can be written. Existing notes are retained for their author."
  },
  {
    key: LIFE_RECONNECT_FLAG,
    title: "Reconnect suggestions",
    category: "Life",
    description: "Optional, warm suggestions to catch up with a Muddy after a long quiet period.",
    enabledImpact: "Eligible suggestions appear. They are always dismissible and never mention how long it has been.",
    disabledImpact: "No suggestions are produced or shown."
  },
  {
    key: LIFE_BIRTHDAYS_FLAG,
    title: "Birthday reminders",
    category: "Life",
    description: "Reminders for birthdays members have explicitly shared. Never inferred.",
    enabledImpact: "Members receive reminders for birthdays they are authorised to see, honouring quiet hours.",
    disabledImpact: "No birthday reminders are scheduled or delivered."
  },
  {
    key: LIFE_MILESTONES_FLAG,
    title: "Friendship milestones",
    category: "Life",
    description: "Factual milestones such as a first plan together or a friendship anniversary.",
    enabledImpact: "Milestones appear in the timeline. They state facts and never imply relationship quality.",
    disabledImpact: "Milestones are hidden. The underlying events remain and can be shown later."
  }
] as const;

export type ManagedFeatureFlagKey = (typeof MANAGED_FEATURES)[number]["key"];

const socializeFeature = MANAGED_FEATURES.find((feature) => feature.key === SOCIALIZE_FLAG)!;

/** Shared reporting catalog. Labels and flag relationships live here once so
 * Admin analytics, release controls, and future lifecycle tools cannot drift. */
export const ANALYTICS_FEATURE_CATALOG = [
  { key: "socialize", title: socializeFeature.title, flagKey: SOCIALIZE_FLAG, eventNames: ["socialize_enabled", "socialize_connection"] },
  { key: "moments", title: "Moments", flagKey: null, eventNames: ["moment_created"] },
  { key: "hangout", title: "UpFor", flagKey: null, eventNames: ["hangout_created", "hangout_joined"] },
  { key: "plans", title: "Plans", flagKey: null, eventNames: ["plan_created"] },
  { key: "events", title: "Events", flagKey: null, eventNames: ["event_created"] },
  { key: "groups", title: "Circles", flagKey: null, eventNames: ["group_created"] },
  { key: "wave", title: "Wave", flagKey: null, eventNames: ["wave_sent"] },
  { key: "ping", title: "Ping", flagKey: null, eventNames: ["ping_sent"] },
  { key: "safe_arrival", title: "Safe Arrival", flagKey: null, eventNames: ["safe_arrival_started", "safe_arrival_completed"] },
  { key: "achievements", title: "Achievements", flagKey: null, eventNames: ["achievement_unlocked"] }
] as const;

export type AnalyticsFeatureKey = (typeof ANALYTICS_FEATURE_CATALOG)[number]["key"];

export function isManagedFeatureFlagKey(value: string): value is ManagedFeatureFlagKey {
  return MANAGED_FEATURES.some((feature) => feature.key === value);
}

export type GlobalFeatureFlagRow = {
  status: "off" | "on" | "rollout" | "archived";
  default_value: boolean;
};

/**
 * Global feature flags fail closed. A rollout needs a subject-aware evaluator;
 * until one is introduced, only its explicit default is safe to use.
 */
export function resolveGlobalFeatureFlag(row: GlobalFeatureFlagRow | null | undefined): boolean {
  if (!row || row.status === "off" || row.status === "archived") return false;
  if (row.status === "on") return true;
  return row.default_value;
}

export async function isFeatureEnabled(admin: Admin, key: string): Promise<boolean> {
  const { data, error } = await admin
    .from("feature_flags")
    .select("status, default_value")
    .eq("key", key)
    .maybeSingle();

  if (error) return false;
  return resolveGlobalFeatureFlag(data);
}

/** Stable subject-aware rollout. Use this for authenticated release surfaces.
 * The database owns hashing so web, PWA, Android, and iOS resolve identically. */
export async function isFeatureEnabledForSubject(
  admin: Admin,
  input: {
    key: string;
    userId: string;
    plan: SubscriptionPlan;
    platform: ExperimentPlatform;
    now?: Date;
  }
): Promise<boolean> {
  const { data: flag, error } = await admin
    .from("feature_flags")
    .select("id")
    .eq("key", input.key)
    .maybeSingle();
  if (error || !flag) return false;
  const { data, error: resolutionError } = await admin.rpc("feature_flag_enabled_for_subject", {
    p_flag_id: flag.id,
    p_user_id: input.userId,
    p_plan: input.plan,
    p_platform: input.platform,
    p_now: (input.now ?? new Date()).toISOString()
  });
  return resolutionError ? false : data;
}

export async function isOpenMomentsEnabled(admin: Admin): Promise<boolean> {
  return isFeatureEnabled(admin, OPEN_MOMENTS_FLAG);
}

export async function isSocializeEnabled(admin: Admin): Promise<boolean> {
  return isFeatureEnabled(admin, SOCIALIZE_FLAG);
}

/**
 * The whole Moments product surface. Broader than isOpenMomentsEnabled: this
 * is the switch that decides whether Moments exists for the user at all.
 */
export async function isMomentsEnabled(admin: Admin): Promise<boolean> {
  return isFeatureEnabled(admin, MOMENTS_FLAG);
}

/** The in-app camera. Never gates ordinary chat media attachments. */
export async function isMadCamEnabled(admin: Admin): Promise<boolean> {
  return isFeatureEnabled(admin, MAD_CAM_FLAG);
}
