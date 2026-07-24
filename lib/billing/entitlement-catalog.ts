import type { BooleanEntitlementKey, NumericEntitlementKey } from "@/lib/billing/entitlements";

/**
 * Human labels for the entitlement keys, used by the admin entitlements matrix.
 * Client-safe (no server / DB deps). The keys mirror lib/billing/entitlements.
 */
export const NUMERIC_ENTITLEMENTS: { key: NumericEntitlementKey; label: string }[] = [
  { key: "max_muddies", label: "Max Muddies" },
  { key: "max_personal_circles", label: "Max personal circles" },
  { key: "max_close_friends", label: "Max close friends" },
  { key: "max_active_plans", label: "Max active plans" },
  { key: "max_plan_participants", label: "Max plan participants" },
  { key: "max_private_groups", label: "Max private groups" },
  { key: "max_group_members", label: "Max group members" },
  { key: "max_daily_moments", label: "Max Moments per day" },
  { key: "max_active_nearby_moments", label: "Max active nearby Moments" },
  { key: "max_active_drops", label: "Max active Drops" },
  { key: "max_safe_arrival_contacts", label: "Max Safe Arrival contacts" },
  { key: "max_active_safe_arrivals", label: "Max active Safe Arrivals" },
  { key: "max_active_hangouts", label: "Max active hangouts" },
  { key: "max_hangout_capacity", label: "Max hangout capacity" },
  { key: "max_polls_per_plan", label: "Max polls per plan" },
  { key: "max_voice_note_seconds", label: "Max voice note length (seconds)" },
  { key: "max_friend_requests_per_day", label: "Max friend requests per day" },
  { key: "max_event_circle_members", label: "Max event circle members" },
  { key: "event_circle_archive_days", label: "Event circle archive (days)" },
  { key: "plan_chat_archive_days", label: "Plan chat archive (days)" },
  { key: "storage_limit_bytes", label: "Storage limit (bytes)" }
];

export const BOOLEAN_ENTITLEMENTS: { key: BooleanEntitlementKey; label: string }[] = [
  { key: "advanced_visibility_schedules", label: "Advanced visibility schedules" },
  { key: "recurring_plans", label: "Recurring plans" },
  { key: "multiple_plan_polls", label: "Multiple plan polls" },
  { key: "voice_notes", label: "Voice notes" },
  { key: "custom_glow_styles", label: "Custom glow styles" },
  { key: "friendship_recaps", label: "Friendship recaps" },
  { key: "event_circle_creation", label: "Event circle creation" },
  { key: "event_drops", label: "Event Drops" },
  { key: "photo_moments", label: "Photo Moments" },
  { key: "public_moments", label: "Publish Open Moments" },
  { key: "qr_check_in", label: "QR check-in" },
  { key: "attendance_export", label: "Attendance export" },
  { key: "community_roles", label: "Community roles" },
  { key: "moderation_dashboard", label: "Moderation dashboard" },
  { key: "community_analytics", label: "Community analytics" },
  { key: "priority_support", label: "Priority support" }
];

const NUMERIC_KEYS = new Set(NUMERIC_ENTITLEMENTS.map((entry) => entry.key));
const BOOLEAN_KEYS = new Set(BOOLEAN_ENTITLEMENTS.map((entry) => entry.key));

export function isNumericEntitlementKey(key: string): key is NumericEntitlementKey {
  return NUMERIC_KEYS.has(key as NumericEntitlementKey);
}

export function isBooleanEntitlementKey(key: string): key is BooleanEntitlementKey {
  return BOOLEAN_KEYS.has(key as BooleanEntitlementKey);
}
