/**
 * Subscriptions & billing admin domain logic.
 *
 * Pure helpers shared by the server actions and the Admin UI. Reuses the
 * canonical SubscriptionPlan / SubscriptionStatus unions and the code
 * entitlement registry — no competing billing model. Prices and plans are
 * never taken from the client; the UI only ever labels server-verified values.
 */

import type { SubscriptionPlan, SubscriptionStatus } from "@/lib/supabase/database.types";
import type { BooleanEntitlementKey } from "@/lib/billing/entitlements";

export const PLAN_LABELS: Record<SubscriptionPlan, string> = {
  free: "Free",
  buddy_plus: "Buddy Plus",
  buddy_pro: "Buddy Pro"
};

export function planLabel(plan: string): string {
  return PLAN_LABELS[plan as SubscriptionPlan] ?? plan;
}

export function planTone(plan: string): "default" | "success" | "warning" | "danger" {
  if (plan === "buddy_pro" || plan === "buddy_plus") return "success";
  return "default";
}

export const STATUS_LABELS: Record<SubscriptionStatus, string> = {
  free: "Free",
  trialing: "Trialing",
  active: "Active",
  past_due: "Past due",
  non_renewing: "Non-renewing",
  attention: "Needs attention",
  cancelled: "Cancelled",
  expired: "Expired"
};

export function statusLabel(status: string): string {
  return STATUS_LABELS[status as SubscriptionStatus] ?? status;
}

export function statusTone(status: string): "default" | "success" | "warning" | "danger" {
  if (status === "active" || status === "trialing") return "success";
  if (status === "past_due" || status === "attention" || status === "non_renewing") return "warning";
  if (status === "cancelled" || status === "expired") return "danger";
  return "default";
}

export const SUBSCRIPTION_STATUSES: readonly SubscriptionStatus[] = [
  "free",
  "trialing",
  "active",
  "past_due",
  "non_renewing",
  "attention",
  "cancelled",
  "expired"
];
export const SUBSCRIPTION_PLANS: readonly SubscriptionPlan[] = ["free", "buddy_plus", "buddy_pro"];

export function isSubscriptionPlan(value: string): value is SubscriptionPlan {
  return (SUBSCRIPTION_PLANS as readonly string[]).includes(value);
}
export function isSubscriptionStatus(value: string): value is SubscriptionStatus {
  return (SUBSCRIPTION_STATUSES as readonly string[]).includes(value);
}

// --- Entitlement overrides (comps) ----------------------------------------
// Every premium boolean feature that can be granted as a per-user override.
// Numeric limits are intentionally omitted from the quick-grant list — they
// carry abuse risk and belong to a considered plan change, not a one-click comp.
export const OVERRIDEABLE_ENTITLEMENTS: { key: BooleanEntitlementKey; label: string }[] = [
  { key: "priority_support", label: "Priority support" },
  { key: "advanced_visibility_schedules", label: "Advanced visibility schedules" },
  { key: "recurring_plans", label: "Recurring plans" },
  { key: "multiple_plan_polls", label: "Multiple plan polls" },
  { key: "custom_glow_styles", label: "Custom glow styles" },
  { key: "friendship_recaps", label: "Friendship recaps" },
  { key: "event_circle_creation", label: "Event circle creation" },
  { key: "event_drops", label: "Event drops" },
  { key: "qr_check_in", label: "QR check-in" },
  { key: "attendance_export", label: "Attendance export" },
  { key: "community_roles", label: "Community roles" },
  { key: "moderation_dashboard", label: "Moderation dashboard" },
  { key: "community_analytics", label: "Community analytics" }
];

const OVERRIDEABLE_KEYS = new Set(OVERRIDEABLE_ENTITLEMENTS.map((entry) => entry.key));

export function isOverrideableEntitlement(key: string): key is BooleanEntitlementKey {
  return OVERRIDEABLE_KEYS.has(key as BooleanEntitlementKey);
}

export function entitlementLabel(key: string): string {
  return OVERRIDEABLE_ENTITLEMENTS.find((entry) => entry.key === key)?.label ?? key.replaceAll("_", " ");
}

// --- Change-log labels ----------------------------------------------------
export const CHANGE_TYPE_LABELS: Record<string, string> = {
  upgrade: "Upgrade",
  downgrade: "Downgrade",
  cancel: "Cancellation",
  reactivate: "Reactivation"
};
export function changeTypeLabel(type: string): string {
  return CHANGE_TYPE_LABELS[type] ?? type.replaceAll("_", " ");
}

// --- Privacy-safe Paystack reference --------------------------------------
/**
 * A display-safe hint that a Paystack reference is linked, revealing only the
 * last 4 characters. NEVER used for authorization codes — those are payment
 * credentials and must never reach the browser at all.
 */
export function maskPaystackReference(code: string | null | undefined): string {
  if (!code) return "Not linked";
  const tail = code.slice(-4);
  return `•••• ${tail}`;
}
