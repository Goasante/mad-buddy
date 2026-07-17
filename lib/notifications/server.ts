import "server-only";

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
    | `drop:${string}`;
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

/**
 * Batched replacement for the old one-query-per-friend throttle check
 * (audit I-13): one read for the last hour's nearby notifications, one
 * batched insert for whichever friends haven't been announced yet.
 * Throttle semantics are unchanged — at most one "friend nearby"
 * notification per friend name per hour.
 */
export async function createNearbyNotificationsIfAllowed(
  supabase: SupabaseAdmin,
  input: {
    userId: string;
    friendDisplayNames: string[];
  }
) {
  if (input.friendDisplayNames.length === 0) {
    return { data: null, error: null };
  }

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
  const namesToAnnounce = input.friendDisplayNames.filter(
    (name) => !recentMessages.some((message) => message.startsWith(name.toLowerCase()))
  );

  if (namesToAnnounce.length === 0) {
    return { data: null, error: null };
  }

  return supabase.from("notifications").insert(
    namesToAnnounce.map((name) => ({
      user_id: input.userId,
      type: "friend_nearby",
      title: "Friend nearby",
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
