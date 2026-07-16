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
  type: NotificationType | `meetup_request:${string}`;
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

export async function createNearbyNotificationIfAllowed(
  supabase: SupabaseAdmin,
  input: {
    userId: string;
    friendDisplayName: string;
  }
) {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data: existing, error } = await supabase
    .from("notifications")
    .select("id")
    .eq("user_id", input.userId)
    .eq("type", "friend_nearby")
    .gte("created_at", oneHourAgo)
    .ilike("message", `${input.friendDisplayName}%`)
    .limit(1);

  if (error || (existing && existing.length > 0)) {
    return { data: null, error };
  }

  return createNotification(supabase, {
    userId: input.userId,
    type: "friend_nearby",
    title: "Friend nearby",
    message: `${input.friendDisplayName} is glowing nearby. Exact location stays private.`
  });
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
