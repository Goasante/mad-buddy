import "server-only";

import { applyEngagementGuards, clampNotificationBudget } from "@/lib/engagement/rules";
import {
  DEFAULT_RECIPIENT_TIMEZONE,
  dayKeyInTimeZone,
  decideNotification,
  isWithinQuietHours,
  minuteOfDayInTimeZone,
  normalizePreferences,
  type NotificationCategory,
  type NotificationPriority
} from "@/lib/notifications/preferences";
import type { Database } from "@/lib/supabase/database.types";

type SupabaseAdmin = ReturnType<typeof import("@/lib/supabase/admin").createSupabaseAdminClient>;

export type NotificationType =
  | "friend_request_received"
  | "friend_request_accepted"
  | "friend_nearby"
  | "best_buddy_nearby"
  | "circle_nearby"
  | "meetup_request"
  | "subscription_update"
  | "system_alert";

export type CreateNotificationInput = {
  userId: string;
  type:
    | NotificationType
    | `meetup_request:${string}`
    | `wave:${string}`
    | `meeting_ping:${string}`
    | `plan:${string}`
    | `hangout:${string}`
    | `safe_arrival:${string}`
    | `event:${string}`
    | `moment:${string}`
    | `drop:${string}`
    | `message:${string}`
    | `group:${string}`
    | `achievement:${string}`;
  title: string;
  message: string;
};

export async function createNotification(
  supabase: SupabaseAdmin,
  input: CreateNotificationInput
) {
  return supabase.from("notifications").insert({
    user_id: input.userId,
    type: input.type,
    title: input.title,
    message: input.message,
    is_read: false
  });
}

export type DeliverNotificationInput = CreateNotificationInput & {
  /**
   * Batch-4 preference category. Omit for notifications with no user-facing
   * category toggle (messages, friend requests, billing, system): those skip
   * the category gate but still respect quiet hours, Exam Mode, and the
   * daily budget.
   */
  category?: NotificationCategory;
  priority?: NotificationPriority;
  /** Who triggered it, for close-friends-only gating. Null for system events. */
  senderId?: string | null;
};

export type DeliveryResult = { inApp: boolean; push: boolean; reason: string };

/**
 * The one send path for user-facing notifications (spec §22 + §51). Composes
 * the batch-4 preference engine with the batch-11 engagement guards:
 *
 *   category preferences → quiet hours → Exam Mode → daily budget
 *
 * Inserts the in-app row only when the preferences allow it, and records
 * budgeted pushes in notification_budget_usage. Preference-read failures fail
 * open to in-app-only delivery, a broken prefs row should never silently
 * swallow a Safe Arrival alert, and never interrupt with a push either.
 */
export async function deliverNotification(
  supabase: SupabaseAdmin,
  input: DeliverNotificationInput
): Promise<DeliveryResult> {
  const priority = input.priority ?? "normal";
  const now = new Date();
  const localMinute = minuteOfDayInTimeZone(now, DEFAULT_RECIPIENT_TIMEZONE);
  const dayKey = dayKeyInTimeZone(now, DEFAULT_RECIPIENT_TIMEZONE);

  const [prefsRes, engagementRes, closeFriendRes, usageRes] = await Promise.all([
    supabase
      .from("user_preferences")
      .select("notification_preferences")
      .eq("user_id", input.userId)
      .maybeSingle(),
    supabase
      .from("engagement_preferences")
      .select("exam_mode_until, exam_mode_allow_close_friends, daily_notification_budget")
      .eq("user_id", input.userId)
      .maybeSingle(),
    input.senderId
      ? supabase
          .from("close_friend_relationships")
          .select("id")
          .eq("owner_id", input.userId)
          .eq("friend_id", input.senderId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("notification_budget_usage")
      .select("sent_count")
      .eq("user_id", input.userId)
      .eq("day_key", dayKey)
      .maybeSingle()
  ]);

  const prefs = normalizePreferences(prefsRes.data?.notification_preferences);
  const fromCloseFriend = Boolean(closeFriendRes.data);

  const base = input.category
    ? decideNotification(prefs, {
        category: input.category,
        priority,
        fromCloseFriend,
        recipientLocalMinute: localMinute
      })
    : {
        inApp: true,
        push: priority === "critical" || !isWithinQuietHours(prefs, localMinute),
        reason: "deliver"
      };

  const engagement = engagementRes.data;
  const decision = applyEngagementGuards(base, {
    priority,
    examModeUntilMs: engagement?.exam_mode_until ? Date.parse(engagement.exam_mode_until) : null,
    examModeAllowCloseFriends: engagement?.exam_mode_allow_close_friends ?? true,
    fromCloseFriend,
    sentToday: usageRes.data?.sent_count ?? 0,
    budget: clampNotificationBudget(engagement?.daily_notification_budget ?? Number.NaN),
    nowMs: now.getTime()
  });

  if (!decision.inApp) return decision;

  await createNotification(supabase, {
    userId: input.userId,
    type: input.type,
    title: input.title,
    message: input.message
  });

  if (decision.push) {
    // Real web push transport; silent no-op until VAPID keys are configured.
    const { sendPushToUser } = await import("@/lib/notifications/push");
    await sendPushToUser(supabase, input.userId, {
      title: input.title,
      body: input.message,
      url: "/notifications"
    });
  }

  // Only budgeted pushes consume the budget, critical/high bypass it, so
  // counting them would let an emergency alert starve tomorrow's normal ones.
  if (decision.push && priority !== "critical" && priority !== "high") {
    await supabase.from("notification_budget_usage").upsert(
      {
        user_id: input.userId,
        day_key: dayKey,
        sent_count: (usageRes.data?.sent_count ?? 0) + 1,
        updated_at: now.toISOString()
      },
      { onConflict: "user_id,day_key" }
    );
  }

  return decision;
}

/**
 * Batched replacement for the old one-query-per-friend throttle check
 * (audit I-13): one read for the last hour's nearby notifications, one
 * batched insert for whichever friends haven't been announced yet.
 * Throttle semantics are unchanged, at most one "friend nearby"
 * notification per friend name per hour.
 */
export async function createNearbyNotificationsIfAllowed(
  supabase: SupabaseAdmin,
  input: {
    userId: string;
    friends: Array<{ friendId: string; displayName: string }>;
  }
) {
  if (input.friends.length === 0) {
    return { data: null, error: null };
  }

  // Honor the "proximity" category preference (spec §22): off suppresses the
  // notification entirely; close-friends-only narrows it to Close Friends.
  const { data: prefsRow } = await supabase
    .from("user_preferences")
    .select("notification_preferences")
    .eq("user_id", input.userId)
    .maybeSingle();
  const proximitySetting = normalizePreferences(prefsRow?.notification_preferences).categories.proximity;
  if (proximitySetting === "off") return { data: null, error: null };

  let allowedFriends = input.friends;
  if (proximitySetting === "close_friends") {
    const { data: closeFriends } = await supabase
      .from("close_friend_relationships")
      .select("friend_id")
      .eq("owner_id", input.userId)
      .in(
        "friend_id",
        input.friends.map((friend) => friend.friendId)
      );
    const closeIds = new Set((closeFriends ?? []).map((row) => row.friend_id));
    allowedFriends = input.friends.filter((friend) => closeIds.has(friend.friendId));
  }
  if (allowedFriends.length === 0) return { data: null, error: null };

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data: existing, error } = await supabase
    .from("notifications")
    .select("message")
    .eq("user_id", input.userId)
    .eq("type", "friend_nearby")
    .gte("created_at", oneHourAgo);

  if (error) {
    return { data: null, error };
  }

  const recentMessages = (existing ?? []).map((row) => row.message.toLowerCase());
  const namesToAnnounce = allowedFriends
    .map((friend) => friend.displayName)
    .filter((name) => !recentMessages.some((message) => message.startsWith(name.toLowerCase())));

  if (namesToAnnounce.length === 0) {
    return { data: null, error: null };
  }

  return supabase.from("notifications").insert(
    namesToAnnounce.map((name) => ({
      user_id: input.userId,
      type: "friend_nearby",
      title: `${name} is nearby`,
      message: `${name} is glowing nearby. Exact location stays private.`,
      is_read: false
    }))
  );
}

export type NotificationRow = Database["public"]["Tables"]["notifications"]["Row"];

export function toNotificationResponse(notification: NotificationRow) {
  return {
    id: notification.id,
    type: notification.type,
    title: notification.title,
    message: notification.message,
    is_read: notification.is_read,
    created_at: notification.created_at
  };
}
