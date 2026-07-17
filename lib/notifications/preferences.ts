/**
 * Smart Notifications decision core (feature architecture batch 4, spec §15-§29).
 * Pure logic for the notification preference model, quiet hours, and the
 * shouldNotify decision engine (spec §22). No I/O — the server action loads
 * preferences and calls decideNotification so the interruption rules live in
 * one tested place.
 */

export type NotificationCategory = "waves" | "pings" | "proximity" | "plans" | "status";
export type NotificationPriority = "critical" | "high" | "normal" | "low";
export type CategorySetting = "all" | "close_friends" | "in_app_only" | "off";

export type NotificationPreferences = {
  categories: Record<NotificationCategory, CategorySetting>;
  quietHoursEnabled: boolean;
  /** Local-time minute-of-day [0,1440) for quiet-hours start/end. */
  quietHoursStartMinute: number;
  quietHoursEndMinute: number;
};

// Recommended defaults (spec §20 quiet hours 11pm–7am, all categories on).
export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  categories: {
    waves: "all",
    pings: "all",
    proximity: "close_friends",
    plans: "all",
    status: "close_friends"
  },
  quietHoursEnabled: true,
  quietHoursStartMinute: 23 * 60,
  quietHoursEndMinute: 7 * 60
};

/** Merges a stored (possibly partial/legacy) JSON blob onto the defaults. */
export function normalizePreferences(raw: unknown): NotificationPreferences {
  const base = DEFAULT_NOTIFICATION_PREFERENCES;
  if (!raw || typeof raw !== "object") return base;
  const value = raw as Partial<NotificationPreferences> & { categories?: Record<string, unknown> };
  const categories = { ...base.categories };
  for (const key of Object.keys(categories) as NotificationCategory[]) {
    const setting = value.categories?.[key];
    if (setting === "all" || setting === "close_friends" || setting === "in_app_only" || setting === "off") {
      categories[key] = setting;
    }
  }
  return {
    categories,
    quietHoursEnabled:
      typeof value.quietHoursEnabled === "boolean" ? value.quietHoursEnabled : base.quietHoursEnabled,
    quietHoursStartMinute: clampMinute(value.quietHoursStartMinute, base.quietHoursStartMinute),
    quietHoursEndMinute: clampMinute(value.quietHoursEndMinute, base.quietHoursEndMinute)
  };
}

function clampMinute(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value < 1440
    ? Math.floor(value)
    : fallback;
}

/**
 * Is `minuteOfDay` inside the quiet-hours window? Handles windows that cross
 * midnight (spec §26: quiet hours cross midnight), e.g. 23:00→07:00.
 */
export function isWithinQuietHours(prefs: NotificationPreferences, minuteOfDay: number): boolean {
  if (!prefs.quietHoursEnabled) return false;
  const { quietHoursStartMinute: start, quietHoursEndMinute: end } = prefs;
  if (start === end) return false;
  return start < end
    ? minuteOfDay >= start && minuteOfDay < end
    : minuteOfDay >= start || minuteOfDay < end; // crosses midnight
}

/**
 * Recipient timezone until per-user timezones are stored. The product launches
 * in Ghana, so quiet hours are evaluated in Accra time rather than server UTC
 * (which happens to coincide, but the intent should be explicit).
 */
export const DEFAULT_RECIPIENT_TIMEZONE = "Africa/Accra";

/** Minute-of-day [0,1440) for `date` in an IANA timezone. */
export function minuteOfDayInTimeZone(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

/** Local calendar day key (e.g. "2026-07-17") for the daily notification budget. */
export function dayKeyInTimeZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

export type NotificationEvent = {
  category: NotificationCategory;
  priority: NotificationPriority;
  /** Whether the sender is one of the recipient's Close Friends. */
  fromCloseFriend: boolean;
  /** Recipient's local minute-of-day, from their timezone (server-derived). */
  recipientLocalMinute: number;
};

export type NotificationDecision = {
  /** Deliver an in-app notification row. */
  inApp: boolean;
  /** Deliver an interrupting push. */
  push: boolean;
  reason: "off" | "not_close_friend" | "in_app_only" | "quiet_hours" | "deliver";
};

/**
 * The decision engine (spec §22). Category setting gates first (off / close-
 * friends-only / in-app-only), then quiet hours suppress push for anything
 * below critical. Critical account events (spec §18) always break through.
 */
export function decideNotification(
  prefs: NotificationPreferences,
  event: NotificationEvent
): NotificationDecision {
  if (event.priority === "critical") {
    return { inApp: true, push: true, reason: "deliver" };
  }

  const setting = prefs.categories[event.category];
  if (setting === "off") return { inApp: false, push: false, reason: "off" };
  if (setting === "close_friends" && !event.fromCloseFriend) {
    return { inApp: false, push: false, reason: "not_close_friend" };
  }
  if (setting === "in_app_only") {
    return { inApp: true, push: false, reason: "in_app_only" };
  }

  // setting === "all" (and close-friends match): in-app always; push unless
  // quiet hours suppress it for non-critical events.
  if (isWithinQuietHours(prefs, event.recipientLocalMinute)) {
    return { inApp: true, push: false, reason: "quiet_hours" };
  }
  return { inApp: true, push: true, reason: "deliver" };
}
